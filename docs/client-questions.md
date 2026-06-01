# Prime Tracker — Client Questions

Questions to confirm with **Prime Developers** before/while building out the
tracker. Organized by area. The **Excel / data migration** section assumes the
client is handing over an existing spreadsheet that we will import as the
seed data.

Priority: **P1** = blocks build/import · **P2** = needed soon · **P3** = nice to clarify

---

## 1. The Excel Sheet (data hand-off & migration)

| # | Question | Why we're asking | Priority |
|---|----------|------------------|----------|
| 1.1 | Is there **one master Excel file** or several (e.g. one per project, one for financials, one for sales)? | Determines import scope and whether we need to merge sources. | P1 |
| 1.2 | Can you share the file with **column headers and 3–5 sample rows** on each tab? | We map every column to a field in the schema (Project, Building, Unit, Loan, Sale, Lease, Budget). | P1 |
| 1.3 | What does **each tab/sheet** represent? Please label them. | Each tab likely maps to one entity (Projects, Units, Loans…). | P1 |
| 1.4 | How are **Projects → Buildings → Units** represented? Is there a building column, or do units sit directly under a project today? | Our model requires every Unit to belong to a Building. If the sheet has no buildings we'll need a default/"Main Building" rule. | P1 |
| 1.5 | What is the **unique identifier** for each project / unit (a code, address, name)? | Needed to de-duplicate and link rows across tabs. | P1 |
| 1.6 | What **currency, number format, and date format** are used? (e.g. $, MM/DD/YYYY) | Prevents misparsed amounts/dates on import. | P1 |
| 1.7 | Are money values **gross or net**, and do any columns include **formulas** vs. raw values? | Formula cells export differently; we need the underlying numbers. | P2 |
| 1.8 | How should we handle **blank / "TBD" / "N/A"** cells? | Decide null vs. zero vs. skip. | P2 |
| 1.9 | Is this a **one-time import** to seed the system, or will you keep updating the Excel and expect **re-imports / sync**? | One-time = simple loader. Ongoing = we need an upload + reconcile feature. | P1 |
| 1.10 | Who is the **point of contact** that owns this spreadsheet and can answer column-level questions? | Single source of truth for mapping decisions. | P2 |
| 1.11 | Do you also want an **"export to Excel"** of any screen/report later? | Affects whether we build export now or defer. | P3 |

---

## 2. Projects & property structure

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 2.1 | How many **active projects** today, and roughly how many total (incl. completed/sold)? | Sizing + pagination/filters. | P2 |
| 2.2 | Do the current **status** values map to ACTIVE / ON_HOLD / COMPLETED / CANCELLED, or do you use different words? | Align enums with your vocabulary. | P1 |
| 2.3 | Same for **phase** (Pre-Dev / Permitting / Construction / Lease-up / Stabilized / Sold-Refi) and **type** (Residential / Commercial / Mixed-Use / Industrial). | Confirm or extend enums. | P1 |
| 2.4 | Are **unit types** (Retail, Medical, Flex, Residential Lot, Office, Restaurant, Event Center) complete, or do we need to add any? | Avoid missing categories at import. | P2 |
| 2.5 | What does **"Prime owned"** mean for a unit, and how is it marked in the sheet? | We have a `primeOwned` flag — need the rule. | P2 |

---

## 3. Financials (budgets, actuals, commitments)

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 3.1 | Do you track at the **budget-line level** (by category), and are the categories below correct? Land Acq, Site Work, Hard Costs, Soft Costs, Financing, Permits/Fees, Contingency, Marketing, Legal, Other. | Confirm budget taxonomy. | P1 |
| 3.2 | Where do **actual spend** figures come from — manual entry, the Excel, or QuickBooks? | Decides import vs. integration. | P1 |
| 3.3 | Do you use **vendor commitments / POs**? How are they tracked today? | Confirms the Commitments module fits. | P2 |
| 3.4 | What **variance threshold** should flag a budget as over (we default to >10%)? | Drives alerts/notifications. | P2 |

---

## 4. Loans & debt

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 4.1 | What **loan types** do you have (Construction, Permanent, Bridge, Mezzanine, SBA)? Any others? | Confirm enum. | P2 |
| 4.2 | Which loan fields are **sensitive** and must be encrypted/restricted (rate, lender, balance)? | We encrypt sensitive loan fields — confirm scope. | P1 |
| 4.3 | Do you track **draw requests** against construction loans? | Confirms draw feature. | P2 |
| 4.4 | How far ahead should we **alert on loan maturity** (default 60 days)? | Notification timing. | P3 |

---

## 5. Sales & leads

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 5.1 | Do your **sale stages** match Prospect → LOI Signed → Under Contract → Closed → Cancelled? | Confirm pipeline. | P1 |
| 5.2 | Do you want **Leads** tracked separately from Sales, with a "convert to sale" step? (We built this.) | Confirm workflow ownership. | P2 |
| 5.3 | What **lead sources / activity types** do you log (calls, emails, tours)? | Configure activity timeline. | P3 |

---

## 6. Leases & rent roll

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 6.1 | Do **lease statuses** match Draft / Active / Expired / Terminated? | Confirm enum. | P2 |
| 6.2 | How is **rent** structured — flat monthly, $/sqft, escalations, CAM? | Rent-roll accuracy. | P1 |
| 6.3 | How early should we **warn on lease expiry** (we use 30 and 7 days)? | Notification timing. | P3 |

---

## 7. Users, roles & access

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 7.1 | Confirm the roles: **Founder, Finance, Project Manager, Sales, Construction, Viewer**. Any others? | Maps to RBAC. | P1 |
| 7.2 | Will everyone sign in with **Google Workspace** under `primedevelopers.com`? Any external users? | OAuth domain restriction. | P1 |
| 7.3 | Who should have **admin (Founder)** rights to manage users? | Initial admin setup. | P2 |
| 7.4 | Should **Finance/Founder** be required to use **MFA**? | We can enforce per role. | P2 |
| 7.5 | Which roles can **see loan / financial** detail vs. just sales/units? | Field-level permissions. | P1 |

---

## 8. Reports, KPIs & notifications

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 8.1 | Which **reports matter most** (portfolio overview, sales summary, revenue, debt)? Any missing? | Prioritize report tabs. | P2 |
| 8.2 | What **KPIs** do leadership look at weekly/monthly? | Dashboard + KPI snapshots. | P2 |
| 8.3 | Do you want **email notifications**, in-app only, or both? | Affects SMTP setup. | P2 |
| 8.4 | What time/timezone should the **daily digest** run (default 8 AM CT)? | Scheduled job config. | P3 |

---

## 9. Integrations

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 9.1 | Do you use **QuickBooks**, and do you want a live sync? Can you provide credentials/company file access? | QB integration is stubbed pending creds. | P2 |
| 9.2 | Any other systems to connect (banking, CRM, DocuSign, Drive)? | Scope integrations. | P3 |
| 9.3 | Should documents (PDFs, contracts) be **attachable** to units/comments? Where are they stored today? | File-attachment feature is not built yet. | P3 |

---

## 10. Rollout & logistics

| # | Question | Why | Priority |
|---|----------|-----|----------|
| 10.1 | Target **go-live date** and any hard deadlines? | Sequencing. | P1 |
| 10.2 | Who are the **first pilot users**, and what's the must-have feature set for day one? | MVP scope. | P1 |
| 10.3 | Should we run a **training/walkthrough** session and provide a quick-start guide? | Adoption. | P3 |
| 10.4 | Any **multi-tenant / multi-entity** need soon (separate companies/LLCs)? | We have multi-tenant hooks ready to enable. | P2 |

---

### Top 5 to get answered first (unblock everything)
1. Share the Excel with headers + sample rows, and label each tab. *(1.2, 1.3)*
2. Confirm Projects → Buildings → Units structure in the sheet. *(1.4)*
3. One-time import vs. ongoing re-import/sync. *(1.9)*
4. Confirm status / phase / type / role vocabularies. *(2.2, 2.3, 7.1)*
5. Go-live date + day-one must-haves + pilot users. *(10.1, 10.2)*
