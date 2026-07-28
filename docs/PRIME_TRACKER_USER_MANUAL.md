# Prime Tracker — User Manual

> **For:** everyone at Prime Developers who uses the platform
> **Version:** 28 July 2026 — covers every screen currently live
> **Companion doc:** [`PRIME_TRACKER_FEATURES.md`](PRIME_TRACKER_FEATURES.md) is the technical reference. This manual is the plain-English "how do I do it" guide.

---

## How to Use This Manual

You do not need to read this front to back. Three ways in:

1. **New to Prime Tracker?** Read [Part 1 — Getting Started](#part-1--getting-started), then jump to the section for your role in [Part 13 — What Can I Do?](#part-13--what-can-i-do-role-quick-reference).
2. **Looking for one thing?** Use the table of contents below, or search the page for the screen name.
3. **Something not working?** Go to [Part 14 — Troubleshooting & FAQ](#part-14--troubleshooting--faq).

Throughout the manual you will see these markers:

> ⚠️ **Blocked?** — explains why something is greyed out or refuses to save. Most of the time it is intentional.

> 💡 **Tip** — a shortcut or a habit worth building.

> 🔒 **Permission** — which roles can do this.

---

## Contents

**Part 1 — [Getting Started](#part-1--getting-started)**
· Signing in · Your session · Multi-factor authentication · The screen layout · Notifications · Things that work the same everywhere

**Part 2 — [Your Dashboard](#part-2--your-dashboard)**
· Founder · Finance · Sales · Construction · The Needs Attention feed

**Part 3 — [Projects](#part-3--projects)**
· Projects list · Creating a project · The project page · All 13 tabs explained

**Part 4 — [Buildings, Units & Inventory](#part-4--buildings-units--inventory)**
· Buildings · Units · Combining units · The Inventory screen · Unit detail

**Part 5 — [Sales & Leasing](#part-5--sales--leasing)**
· The sales pipeline · Closing a sale · Discounts that need approval · Cancelling a sale · Payment schedules · Leases & rent roll

**Part 6 — [Leads, Campaigns & Brokers](#part-6--leads-campaigns--brokers)**
· Leads · Activities · Unit interest & waitlists · Converting to a sale · Campaigns · Brokers & commissions

**Part 7 — [Money](#part-7--money)**
· Budgets · Commitments & actuals · Loans · Draw requests · Cash flow · Receivables · Investors

**Part 8 — [Construction](#part-8--construction)**
· Milestones · Daily logs · Vendors & contracts

**Part 9 — [Interior / Fit-Out](#part-9--interior--fit-out)**
· How a fit-out moves through 7 phases · Scope · Invoices · Snags · Handover

**Part 10 — [Documents, Comments & Tasks](#part-10--documents-comments--tasks)**

**Part 11 — [Reports](#part-11--reports)**

**Part 12 — [Settings & Administration](#part-12--settings--administration)**

**Part 13 — [What Can I Do? Role Quick Reference](#part-13--what-can-i-do-role-quick-reference)**

**Part 14 — [Troubleshooting & FAQ](#part-14--troubleshooting--faq)**

**Part 15 — [Glossary](#part-15--glossary)**

---
---

# Part 1 — Getting Started

## 1.1 Signing In

Prime Tracker uses your company Google account. There is no separate Prime Tracker password to remember.

**To sign in:**

1. Open Prime Tracker in your browser.
2. Click **Sign in with Google**.
3. Choose your **@primedevelopers.com** account.
4. Complete Google's sign-in as normal.
5. You land directly on the dashboard for your role.

**Two things must both be true for sign-in to work:**
- You are using a **@primedevelopers.com** Google account (personal Gmail is rejected), **and**
- An Administrator has already added you to Prime Tracker and your account is active.

If Google signs you in but Prime Tracker shows an access error, it is almost always the second one. Contact your Administrator.

---

## 1.2 Your Session — Nothing to Manage

Once you are in, the app handles everything in the background.

| | |
|---|---|
| **While you are working** | Your session refreshes itself silently every 15 minutes. You will never be interrupted mid-task. |
| **If you close the browser** | You stay signed in for up to **7 days**. Come back within that window and you go straight in. |
| **After 7 days of not using it** | Your session expires and you are taken to the login page. Sign in with Google again. |

**To sign out manually:** click your name or avatar in the top-right corner → **Sign out**.

---

## 1.3 Multi-Factor Authentication (MFA)

MFA adds a second check using an authenticator app on your phone — Google Authenticator, Authy, or Microsoft Authenticator all work.

**Who needs it:** Finance and Founder roles are prompted with a banner until they enrol. Any user can enable it voluntarily. Certain sensitive actions will also ask you to re-verify even mid-session.

### Setting up MFA (one time, 2 minutes)

1. Click your avatar in the top-right → **Set up MFA**. (Finance and Founder users will also see a banner on their dashboard.)
2. A 4-step window opens:
   - **Step 1 — Introduction.** What MFA is and why it matters.
   - **Step 2 — Scan.** Open your authenticator app and scan the QR code on screen.
   - **Step 3 — Verify.** Type the 6-digit code your app is showing right now.
   - **Step 4 — Done.**
3. That's it. Keep the authenticator app on your phone.

### The step-up prompt

Sometimes you will click something and a small window asks for your 6-digit code even though you are already signed in. This is normal — it protects the most sensitive actions. Enter the current code and continue.

> ⚠️ **Code rejected?** Almost always a clock problem. Set your phone's date & time to **automatic / network time** and try again. Codes change every 30 seconds — enter it before it refreshes.

> **Lost your phone?** Contact your Administrator. They can reset your MFA so you can set it up on a new device. You cannot get in without it.

---

## 1.4 The Screen Layout

Every screen shares the same frame.

### The left sidebar — where everything lives

You only see the items your role is allowed to use, so your sidebar may be shorter than a colleague's.

| Item | What it's for |
|---|---|
| **Dashboard** | Your role's home screen |
| **Projects** | Every development, and the way into all project detail |
| **Inventory** | Every unit across every project, in one list |
| **Interior** | Fit-out projects portfolio |
| **Cash Flow** | Forward money projection |
| **Receivables** | Buyer instalments coming due |
| **Tasks** | Your work items across all projects |
| **Leads** | Enquiries and the sales funnel |
| **Ads & Campaigns** | Marketing spend and its results |
| **Investors** | Equity, capital calls, distributions |
| **Brokers** | Broker list and commissions |
| **Reports** | Cross-project reporting |
| **Admin** | User and system management |

Click the collapse arrow to shrink the sidebar to icons only — useful on a laptop.

### The top bar

- **🔔 Bell icon** — your notifications, with an unread count. Checks for new items every 30 seconds.
- **Your avatar** — profile, MFA setup, sign out.

---

## 1.5 Notifications

### Reading them

Click the bell. A panel drops down with your recent notifications, newest first. Click any one to jump straight to what it's about. Clicking marks it read.

### What Prime Tracker will notify you about

| Area | You'll hear about |
|---|---|
| **Construction** | A milestone has gone overdue |
| **Leasing** | A lease expires in 30 days, and again at 7 days |
| **Debt** | A loan matures within 60 days |
| **Draws** | A draw was submitted, approved, or funded |
| **Budget** | A category went over its variance threshold |
| **Leads** | A lead was assigned to you; a lead changed status |
| **Comments** | A new Marketing / Sales / Financial comment |
| **Interior** | A fit-out changed phase; handover is due; a snag is overdue |
| **Payments** | A buyer instalment is due in 7 days, or is now overdue |

Most of these are generated by a **daily check that runs at 8:00 AM Central**, so you get one coherent morning picture rather than a drip all day.

### Choosing what you get

Go to **Settings → Notifications** (`/settings/notifications`). Every notification type has an on/off switch. Turning one off stops both the in-app notification and the email.

> 💡 **Tip** — Don't turn off *Payment overdue* or *Draw funded*. Those are the two that cost money when missed.

---

## 1.6 Things That Work the Same Everywhere

Learn these once and every screen gets easier.

**Cards and tables.** Most lists are cards on a wide screen and stack vertically on a narrow one. Clicking a card or row opens the detail.

**Coloured chips.** Status is always a coloured pill. Green = good/complete, amber = in progress/attention, red = problem/overdue, blue = informational, grey = not started.

**"Add" buttons** sit at the top-right of the section they belong to.

**Edit and delete** appear as small icons on hover, or in a "⋯" menu on the row.

**Filters** sit above the list. They combine — filtering by project *and* status narrows to both.

**Empty states** tell you what's missing and usually give you the button to fix it ("No brokers yet — Add broker").

**Greyed-out buttons** mean your role can't do that action. This is deliberate, not a bug. See [Part 13](#part-13--what-can-i-do-role-quick-reference).

**Nothing is truly deleted.** Deleting archives the record. History, audit trail and reporting stay intact.

**Toasts.** A small message appears at the corner after you save — green for success, red for a problem, with the reason.

---
---

# Part 2 — Your Dashboard

Prime Tracker sends you to the right dashboard automatically when you log in. You never have to pick.

| Your role | Where you land |
|---|---|
| Super Admin, Founder, Executive | **Founder Dashboard** |
| Finance, Accounting, AR/AP | **Finance Dashboard** |
| Sales, Marketing | **Sales Dashboard** |
| Project Manager, Construction | **Construction Dashboard** |
| Legal | **Projects list** |
| Viewer and others | **General Portfolio Dashboard** |

---

## 2.1 Founder Dashboard

The whole business on one screen.

**Portfolio health** — total projects, active projects, budget utilisation, net monthly cash flow, loan book total.

**Construction financials** — total budget, total actuals, budget variance, loan available and monthly debt service.

**Sales & marketing financials** — closed sales year-to-date, projected value of unsold units, value under contract, monthly lease income with its annual equivalent.

**Charts** — projects by phase (pie), units by status (bar).

**Overdue milestones** — every milestone currently late, across all projects. Click a row to go straight to it.

**Needs Attention** — the live exception feed (see [2.5](#25-the-needs-attention-feed)).

**Pending approvals** — draws waiting on your sign-off. This is your action list.

**Unsold units by project and building** — a hierarchical table with available count, estimated value, and under-contract value.

**Recent comments** — the latest 20 across the portfolio, grouped Marketing → Sales → Financial.

---

## 2.2 Finance Dashboard

**Budget position** — budget vs. committed vs. actual across the portfolio, with variance flagged.

**Cash flow summary** — projected inflow, outflow and net for the coming months.

**Receivables widget** — buyer instalments coming due, and anything overdue. Click through to the full [Receivables](#77-receivables--money-coming-in) screen.

**Draws by status** — how many draws sit in draft, submitted, approved, funded.

**Loans** — balances outstanding and monthly debt service.

**Budget variance alerts** — categories that have crossed the threshold.

**Capital calls outstanding** — investor money requested but not yet received.

---

## 2.3 Sales Dashboard

**Lead funnel** — how many leads sit at each of the ten stages.

**Sales pipeline** — deals grouped by status, with total pipeline value.

**Weighted forecast** — the realistic revenue number (see [5.3](#53-the-weighted-forecast--why-two-numbers)).

**Conversion rates and average days to close.**

**Unit availability** — what's actually sellable right now.

**Campaign performance** — spend against leads and conversions.

**Stale deals** — anything with no activity for 14+ days. Work this list first.

---

## 2.4 Construction Dashboard

**Milestone status** across your projects, with overdue items called out.

**Recent daily logs** with site photos — the last few days of progress at a glance.

**Draws in flight** — where each draw sits in the approval chain.

**Building phase progress.**

**Your construction tasks.**

> ⚠️ **No money on this screen — by design.** The Construction role cannot see budgets, spend or variance anywhere in Prime Tracker. Project Managers see the *budget* but not detailed financials. This was a deliberate decision about who sees cost data.

---

## 2.5 The "Needs Attention" Feed

This feed appears on dashboards and on each project's Overview tab. It is computed live from seven sources:

| Shows up when | Category |
|---|---|
| A milestone is past its due date | Milestone |
| A unit has been available more than 90 days | Unit |
| A draw is past its expected funding date | Draw |
| A draw is waiting for internal approval | Draw |
| A budget category is over its variance threshold | Budget |
| A lease expires within 30 days | Lease |
| A sale has had no activity for 14+ days | Sale |

Items are colour-coded **critical (red) · warning (amber) · info (blue)** and every item is clickable — it takes you to the exact record.

> **You only see what your role is allowed to see.** Draw, sale and lease items are hidden from roles without access to those areas, because the feed carries lender, buyer and tenant names.

---
---

# Part 3 — Projects

## 3.1 The Projects List

Sidebar → **Projects**.

Each project shows as a card with:
- Name, status and phase
- **Health ring** — a 0–100 score (see [3.4](#34-the-health-score--what-the-ring-means))
- Phase progress bar
- Unit counts
- Financial summary (only if your role can see financials)

**Filters:** status, phase, type, and free-text search.

---

## 3.2 Creating a Project

🔒 **Permission:** Super Admin, Founder, Project Manager

1. **Projects → Add Project**
2. Fill in name, type (Residential / Commercial / Mixed-Use / Industrial), status, address and dates.
3. Save.
4. Now add **Buildings** — a project holds no units directly. See [Part 4](#part-4--buildings-units--inventory).

> **The phase is calculated for you.** You don't set a project's phase. It is derived from its buildings: the project sits at the most advanced phase any of its buildings has reached.

---

## 3.3 The Project Page

`Projects → [click a project]`

At the top: a single header card with the project's identity on the left and its financial/occupancy summary on the right, plus the health ring.

Below that: up to **13 tabs**. You see only the tabs your role allows, and the URL keeps your place — `/projects/{id}/units` links straight to the Units tab.

| Tab | What's in it |
|---|---|
| **Overview** | Key numbers, health, phase progress, Needs Attention, team members |
| **Construction** | Buildings — create, edit, reorder, cover photos, per-building budget |
| **Budget** | Budget lines, revision history, variance, cash obligations |
| **Revenue** | Sales pipeline + leases and rent roll |
| **Units** | All units grouped by building |
| **Milestones** | Schedule, dependencies, progress photos |
| **Leads** | Enquiries for this project, with activity timeline |
| **Draws** | Loan draw requests and their approval chain |
| **Vendors** | Contracts, change orders, payments |
| **Documents** | The document vault for this project |
| **Tasks** | Work items |
| **Comments** | Project discussion, by type |
| **Activity** | Full audit history *(Founder & Super Admin only)* |

---

## 3.4 The Health Score — What the Ring Means

The number in the ring is **0–100 and measures one thing: how well the project is absorbing its units.**

Roughly:

- Every **sold** unit and every **leased or occupied** unit counts as full credit.
- Every unit **under contract** or **lease pending** counts as half credit — it isn't closed yet.
- Units **under construction** are excluded entirely; you can't sell what isn't built.
- Then a penalty: **5 points for every unit sitting available longer than 90 days**, up to 30 points.

A brand-new project with nothing to sell scores a neutral **80** rather than zero.

Hover the ring to see the plain-English reason, e.g. *"8 sold, 3 leased, 4 vacant of 21 marketable (1 stale >90d)."*

> **What the score does not include:** budget or schedule. Those have their own alerts — the Needs Attention feed and budget variance. The health ring is purely a sales/leasing absorption signal.

---

## 3.5 Overview Tab

- **Key figures** — units, budget position (if permitted), pipeline
- **Phase progress bar**
- **Needs Attention** for this project only
- **Team members** — add or remove people from the project team here

> **Why the team list matters.** Project Managers, Construction, Sales and Marketing users **only see projects they have been added to**. If a colleague in one of those roles says "I can't find the project," add them here. Founders, Executives, Finance, Accounting, AR/AP, Legal and Viewers always see everything.

---

## 3.6 Activity Tab

🔒 **Founder and Super Admin only.**

A complete chronological record of everything done on this project — who changed what, when, and from what to what. Nothing can be edited or removed here.

---
---

# Part 4 — Buildings, Units & Inventory

## 4.1 Buildings (Construction Tab)

A project contains buildings; buildings contain units. Nothing skips a level.

### Adding a building

🔒 Super Admin, Founder, Project Manager, Construction *(with building edit rights)*

1. **Project → Construction tab → Add Building**
2. Enter name, **type**, storeys, square footage and phase.
3. Save.

### The building types

| Type | Use it for |
|---|---|
| Residential / Commercial / Mixed-Use / Industrial | Standard structures |
| Retail / Office | Specific commercial use |
| Parking / Amenity | Supporting structures |
| **Lot** | **Raw land sold by acreage.** A LOT usually has no units inside — you attach the sale or lease to the building itself. |

### Cover photos

Click the photo area on a building card to upload a cover image. It appears everywhere that building is listed.

### Reordering buildings

Drag the handle on the left of a building row to put buildings in site order rather than alphabetical. The order sticks for everyone.

### Building detail page

Click a building name to open its own page — its units, budget rollup, documents and daily logs.

---

## 4.2 Units

### Adding a unit

🔒 Super Admin, Founder, Project Manager, Sales, Marketing

1. **Project → Units tab → Add Unit**
2. **Choose a building** — this is required. A unit cannot exist without one.
3. Enter unit number, type, area, asking price and status.
4. Save.

### Unit statuses

| Status | Meaning |
|---|---|
| **Available** | On the market now |
| **Under Contract** | Reserved by a sale in progress |
| **Lease Pending** | Reserved by a lease in progress |
| **Leased** | Under an active lease |
| **Occupied** | Physically occupied |
| **Sold** | Sale closed |
| **Under Construction** | Not yet sellable or leasable |

> Your Administrator can add more statuses under **Admin → Options** if Prime needs a status this list doesn't cover.

### Time on market

The moment a unit becomes **Available**, Prime Tracker starts a clock. You'll see it as a small bar on the unit card. It stops when the unit sells or leases, and restarts if a sale is cancelled and the unit goes back on the market.

That clock drives: the stale-inventory alerts, the health score penalty, and the Vacancy Report.

### Statuses that change themselves

You usually don't set these by hand:

- **Closing a sale** → the unit flips to **Sold** automatically and the market clock clears.
- **Cancelling a sale** → if the unit was being held (Under Contract or Lease Pending), it flips back to **Available** and the clock restarts.

> A unit that is already Sold, Leased or Occupied is never overwritten by a cancellation.

---

## 4.3 Combining Units

Use this when two suites are knocked together into one.

🔒 Super Admin, Founder, Project Manager. **Sales cannot combine units.**

1. **Project → Units tab → Combine units**
2. Pick the building.
3. Tick **two or more** units.
4. Enter a **number for the new combined unit**. Prime Tracker suggests something like `101+102`.
5. Confirm.

**What happens:** a new unit is created with the areas added together. The original units are archived and permanently linked to the new one — their sales, leases and comments stay on the originals, so nothing is lost. The new unit's page shows where it came from.

> ⚠️ **It will refuse to combine if:**
> - You selected fewer than two units
> - You didn't give the combined unit a number
> - **Any selected unit has a sale attached, an active lease, or an interior fit-out project.** Close or detach those first.
> - The number you chose already belongs to another live unit in that building. (Numbers from previously archived units *can* be reused.)

---

## 4.4 The Inventory Screen

Sidebar → **Inventory**. Every unit across every project in one list.

**Four counters at the top:** Total Units · Available · Occupied/Leased · Sold.

**Filter by:** project, building, status, unit type, or search.

**Each row shows:** unit number, building, project, type, area, price, status, and time on market.

**You can:** update a unit's status inline (if permitted) or click through to the unit's full page.

> 💡 **Tip** — This is the fastest way to answer "what have we actually got available right now?" Filter to Available, sort by time on market, and you're looking at your problem inventory.

---

## 4.5 Unit Detail Page

Click any unit anywhere to open it. This is the deepest view in the app.

- **Facts** — number, building, type, area, asking price, status, time on market
- **If sold** — sale details and the full buyer payment schedule
- **If leased** — tenant profile and lease terms
- **If it has a fit-out** — the interior project's phase and progress
- **Comments** — the full thread, with type selector
- **Documents** — anything filed against this unit
- **Leads** — who has expressed interest in this specific unit

---
---

# Part 5 — Sales & Leasing

## 5.1 The Sales Pipeline

**Project → Revenue tab**, or the Sales Dashboard for the cross-project view.

### The five stages

```
Prospect → LOI Signed → Under Contract → Closed
                                       ↘ Cancelled
```

### Creating a sale

🔒 Super Admin, Founder, Sales

1. **Revenue tab → Add Sale**
2. Attach it to **either a unit or a building** — one or the other, never both. (Whole-building sales and land parcels attach to the building.)
3. Enter buyer, sale price, status, and the relevant dates (LOI, contract, expected close).
4. Save.

### Pipeline metrics you get for free

- **Total pipeline value** — every open deal added up
- **Closed revenue** — what's actually booked
- **Average days to close** — your real sales velocity, measured from creation to close

---

## 5.2 Sales Velocity & Stale Deals

Every time you touch a sale, Prime Tracker stamps it with the time. If a deal goes **14 days with no activity at all**, it appears in the Needs Attention feed and on the Sales Dashboard's stale list.

> 💡 Logging a call or a note counts as activity. Working the stale list daily is the single highest-value habit in the Sales module.

---

## 5.3 The Weighted Forecast — Why Two Numbers

You'll see two revenue figures and they mean different things.

**Total pipeline value** adds up every open deal at full price. It overstates — not every prospect closes.

**Weighted forecast** multiplies each deal by how likely that stage is to close:

| Stage | Likelihood |
|---|---|
| Prospect | 10 % |
| LOI Signed | 35 % |
| Under Contract | 75 % |
| Closed | 100 % (reported separately as booked revenue) |
| Cancelled | 0 % |

A ₹10 M deal at LOI contributes ₹3.5 M to the forecast. **This is the number to show a lender** — it's neither optimistic nor pessimistic.

Each deal carries a small probability chip so you can see its weighting at a glance. Your Administrator can adjust these percentages for the organisation.

---

## 5.4 Discounts That Need Founder Approval

Prime's rule: **a sale priced more than 5 % below the unit's asking price needs Founder or Co-Founder sign-off.**

**What you'll experience:** you try to move the deal to **Under Contract** or **Closed** and it refuses to save, telling you the discount needs approval.

**How to clear it:**

1. A Founder, Executive or Super Admin opens the sale.
2. They click **Approve discount**.
3. Their name and the timestamp are recorded on the sale permanently.
4. You can now move the deal forward.

Only **one** approval is needed — there is no multi-step chain. The 5 % threshold is configurable by your Administrator.

---

## 5.5 Closing a Sale

1. Open the sale.
2. Set status to **Closed** and fill in the closing date.
3. Save.

**Three things happen automatically:**
- The **unit flips to Sold** and its market clock clears.
- If a broker is attributed, their **commission is calculated and recorded** on the sale.
- The pipeline, forecast, health score and dashboards all update.

> If two people close the same sale at the same moment, only one wins — the commission can never be recorded twice.

---

## 5.6 Cancelling a Sale

1. Open the sale → set status to **Cancelled**.
2. **You must choose a reason:** Price too high · Financing fell through · Chose competitor · Timing off · No response · Other.
3. Save.

**The unit is released automatically** — if it was Under Contract or Lease Pending it returns to **Available** and its time-on-market clock restarts. A unit that was already Sold or Leased is never touched.

> 💡 Cancellation reasons are the raw material for "why are we losing deals?" Choose honestly rather than defaulting to Other.

---

## 5.7 Buyer Payment Schedules

Instead of one lump sum, a sale can carry a schedule of instalments — and those instalments can be triggered by real events, not just calendar dates.

### Adding instalments

🔒 Sales, Founder, Super Admin

1. Open the sale → **Payment schedule** → **Add**.
2. Give it a label ("Booking amount", "On foundation", "On handover").
3. Enter an **amount** or a **percentage of the sale price**.
4. Choose a **trigger**:

| Trigger | Becomes due when |
|---|---|
| **On signing** | The contract is signed |
| **On milestone** | **A construction milestone you pick is completed** — the due date is stamped automatically |
| **Fixed date** | A date you choose |
| **On handover** | **The interior fit-out reaches Handover** — this is how the fit-out portion gets billed |

5. Save.

> 💡 **Use a template.** If Prime uses a standard payment structure, use **Generate from template** to create the whole schedule in one step instead of adding instalments one by one.

### Recording a payment

🔒 Finance, Accounting, AR/AP, Project Manager

1. Open the sale → find the instalment → **Log payment**.
2. Enter the amount received. **Partial payments are fully supported.**
3. Save.

The status updates itself:

| | |
|---|---|
| Nothing received | **Scheduled** or **Due** |
| Some received | **Partially Paid** |
| Full amount received | **Paid** |
| Past due, still unpaid | **Overdue** (set automatically) |
| Written off | **Waived** (set manually) |

You'll be reminded **7 days before** an instalment is due, and again once it goes **overdue**.

---

## 5.8 Leases & Rent Roll

**Project → Revenue tab** (lower half).

### Creating a lease

🔒 Sales, Marketing, Founder, Super Admin

1. **Revenue tab → Add Lease**
2. Attach to a **unit or a building**.
3. Enter tenant, start and end dates, monthly rent, deposit.
4. Optionally set an **escalation** — a percentage and how often it applies. The cash-flow projection will apply it automatically going forward.
5. Save.

### Lease statuses

**Draft · Active · Expired · Terminated · Owner Occupied**

> **Owner Occupied** is for space Prime uses itself. It correctly counts as neither vacant nor rental income.

### Expiry warnings

You'll be notified **30 days** before a lease expires and again at **7 days**. Expiring leases also appear in the Needs Attention feed.

### Rent roll

The Revenue tab shows the live rent roll — every active lease, its rent, and the total monthly and annualised income. Prime Tracker also saves periodic snapshots so you can compare against a past date.

> ⚠️ **One active lease per unit.** The system will not let you create a second active lease on a unit that already has one. End the existing lease first.

---
---

# Part 6 — Leads, Campaigns & Brokers

## 6.1 Leads

Sidebar → **Leads** for everything, or **Project → Leads tab** for one project.

### The ten-stage funnel

```
New → Potential → Contacted → Site Visit → Qualified → Proposal Sent → Negotiating → Converted
                                                                                   ↘ Lost / Dead
```

### Creating a lead

🔒 Sales, Marketing, Founder, Super Admin

1. **Leads → Create a new lead**
2. Required: **project**, **name**, **phone**, **source**.
3. Optional but valuable: email, budget, building, unit, **campaign**, assigned owner, notes.
4. Save.

### Where leads come from

Website · Social media · Referral · Cold call · Walk-in · Signage · Email campaign · Broker · **LoopNet** · **CREXi** · Other.

> 💡 **Always set the source, and the campaign if there is one.** This is the only thing that makes campaign ROI and broker performance calculable later. A lead with no source is a lead you can never learn from.

---

## 6.2 Logging Activity

Open a lead → the **activity timeline** panel on the right.

**Add activity** and choose: Call · Email · Meeting · Site Visit · Follow-up · Note.

Status changes are logged for you automatically — you don't need to write "moved to Qualified."

The timeline is the full history of the relationship. When a colleague picks up your lead, this is what tells them where things stand.

---

## 6.3 Unit Interest & the Waitlist

A lead is rarely interested in exactly one unit.

**To record interest:** open the lead → **Add unit interest** → pick a unit → optionally add a note about what they liked. Add as many as apply.

**To see demand for a unit:** open the unit → the interest list shows **every lead that wants it, oldest first**.

> 💡 **This is your call list.** When a unit frees up — a sale falls through, a lease ends — open the unit and you already have a ranked list of people to phone. It's also a pricing signal: eight people interested in one unit is telling you something.

---

## 6.4 Converting a Lead to a Sale

🔒 **Sales only** (plus Founder and Super Admin). **Marketing deliberately cannot convert** — Marketing generates leads, Sales closes them.

1. Open the lead → **Convert to sale**
2. Fill in: unit, buyer name, sale price, contract date, expected close date.
3. Confirm.

**In one step:** the sale is created, the lead is linked to it permanently, the lead moves to **Converted**, and the conversion is logged in the activity timeline. The attribution chain — campaign → lead → sale → revenue — is now complete.

---

## 6.5 Campaigns

Sidebar → **Ads & Campaigns**.

🔒 **Marketing owns this module** (create, edit, record spend, delete). Sales and Founders can view. Marketing cannot see financial data elsewhere in the app.

### Creating a campaign

1. **Ads & Campaigns → Add campaign**
2. Name and **channel**: Meta · Google Ads · Newspaper · Broker · Email · Signage · Event · Other.
3. **Projects** — select **one or more**. One campaign can legitimately promote three developments and the reporting still attributes correctly.
4. Planned budget, status (Planned / Active / Paused / Completed), start and end dates.
5. Optional external ID (e.g. the Meta campaign ID) and notes.
6. Save.

### Recording spend

Open a campaign → **Add spend** → amount, date, **source**, optional external reference.

| Source | Use when |
|---|---|
| **Manual** | You're entering it yourself |
| **Agency report** | Bulk entry from the agency's monthly statement |
| Meta API / Google Ads API | Reserved for future automatic sync |

### Reading the performance numbers

The four cards at the top: **Active campaigns · Total spend · Leads / conversions · Overall ROI.**

Per campaign:

| Metric | What it means |
|---|---|
| **Total spend** | Everything in the spend ledger |
| **Leads** | Leads attributed to this campaign |
| **Weighted leads** | Leads adjusted for how far down the funnel they are |
| **Conversions** | Leads whose sale actually **closed** |
| **Cost per lead (CPL)** | Spend ÷ leads |
| **Cost per acquisition (CPA)** | Spend ÷ conversions |
| **ROI** | Closed revenue ÷ spend |

> **Only closed sales count as revenue.** A lead that "converted" but whose deal later fell apart does not inflate the ROI. The number is honest by construction.

---

## 6.6 Brokers & Commissions

Sidebar → **Brokers**.

🔒 Sales, Marketing, Founder, Executive, Finance can view; Sales and Marketing can edit.

> Brokers do **not** log in to Prime Tracker. This is internal tracking only.

### Adding a broker

1. **Brokers → Add broker**
2. Name, company, email, phone.
3. Set **one** of:
   - **Commission rate (%)** — default percentage of sale price
   - **Flat fee ($)** — used when no percentage is set
4. Notes → Save.

### How commission actually works

1. You attribute a lead (or a sale) to the broker.
2. Nothing accrues while the deal is open.
3. **The moment the sale closes**, Prime Tracker calculates the commission and records it on the sale.
4. When you actually pay them, open the sale in the broker's list → **Mark commission paid**.

Accrued-but-unpaid commissions automatically appear in the **Commissions** bucket of the cash-flow obligations view — so what you owe brokers is always in the cash picture.

### The broker report

Four cards: **Brokers · Leads brought · Closed sales · Commission earned.** Open any broker to see their last 50 leads and last 50 sales with commission status.

---
---

# Part 7 — Money

> 🔒 **A note on visibility.** Financial data is restricted by design. **Construction cannot see budgets, spend or variance at all.** **Project Managers see the budget but not detailed financials.** **Legal sees no financial data.** If a number seems to be missing for you, that is the reason.

---

## 7.1 Budgets

**Project → Budget tab.**

### Adding a budget line

🔒 Finance, Accounting, Founder, Super Admin

1. **Budget tab → Add budget line**
2. Choose a **category** — Land Acquisition · Site Work · Hard Costs · Soft Costs · Financing · Permits & Fees · Contingency · Marketing · Legal · Other *(your Administrator can add more)*.
3. Enter description and the original amount.
4. Optionally **scope it to a specific building or unit** rather than the whole project.
5. Save.

### Revising a budget — and why you must give a reason

You never overwrite a budget. Every change is recorded.

1. Open the budget line → **Revise**.
2. Enter the new amount.
3. **Choose why:**

| Reason | Use when |
|---|---|
| Scope add | You're genuinely adding work |
| Cost increase | Same work, the vendor raised the price |
| Reallocation | Money shifted from another category |
| Estimate refined | You simply know more now |
| Change order | A formal vendor change order |
| Other | Anything else |

4. Add a note → Save.

The revision history is permanent and visible on the line. Six months later, "why are we over budget?" has a real answer instead of a shrug.

### Reading the variance bars

Each category shows **budget · committed · actual · remaining** with a coloured bar. Green is comfortable, amber is close, red is over. Crossing the threshold (10 % by default) also triggers a notification and puts the project in the Needs Attention feed.

### Approved budget vs. working budget

The **approved budget** is the board-approved total, set separately. Compare it against the sum of your budget lines to see how far the working plan has drifted from what was signed off.

---

## 7.2 Cash Obligations (Budget Tab)

Below the budget lines sits the **obligations panel** — what Prime actually owes, in five buckets, viewable **Monthly / Quarterly / Annually**:

| Bucket | Made up of |
|---|---|
| **Loan Payments** | Scheduled debt service |
| **Sub-contractor AP** | Open vendor commitments |
| **TI / Interior** | Interior fit-out invoices |
| **Commissions** | Broker commissions earned but unpaid |
| **Miscellaneous** | Everything else |

> 💡 This is the answer to "how much cash do we need over the next month/quarter/year?" — and it's available to Project Managers, who can see obligations without seeing the full financial module.

---

## 7.3 Commitments & Actuals

**Commitments** = money promised but not yet spent (POs, signed vendor contracts).
**Actuals** = money actually spent.

🔒 Finance, Accounting, AR/AP

Both can be scoped to a building or unit, and both feed budget variance and the cash-flow projection.

**Actuals arrive three ways:**
1. **Manual entry** — Add actual.
2. **QuickBooks sync** — bills and payments come across automatically.
3. **Automatically when a draw is funded** — see [7.6](#76-when-a-draw-is-funded).

### Unmapped QuickBooks transactions

Some QuickBooks entries arrive without enough information to know which project they belong to. They land in an **Unmapped** list for someone to assign. Check it periodically — unmapped spend is spend that isn't showing up in any project's variance.

---

## 7.4 Loans

**Project → Draws tab** (loans and draws live together).

### Adding a loan

🔒 Finance, Founder, Super Admin

1. **Add loan**
2. Attach at **project level** (a portfolio loan) **or building level** (a per-tower construction loan) **or unit level**.
3. Enter lender, **type** (Construction · Permanent · Bridge · Mezzanine · SBA, extendable by your Administrator), principal, rate, dates, maturity.
4. Save.

Sensitive loan details are **encrypted** in the database.

### Monthly payments

Prime Tracker computes your monthly debt service and uses it in the Debt Report, the Finance Dashboard, and the Loan Payments bucket in cash flow.

### Maturity warnings

You are notified when a loan matures within **60 days**.

### The draw schedule

Plan your draws in advance: date, amount, and optionally the **milestone that should trigger it**. When that milestone is marked complete, Prime Tracker creates the draft draw for you.

---

## 7.5 Draw Requests — Step by Step

This is the most tightly controlled workflow in Prime Tracker, because lenders are strict and a missing document costs weeks.

### The path a draw takes

```
Draft ──submit──▶ Submitted ──internal approval──▶ Approved ──funded──▶ Funded ✓
  ▲                    │                              │
  │              returned for info                 rejected
  └────────────────────┘                              ▼
                       └──── rejected ─────▶      Rejected

  A draw can be cancelled from any stage before funding.
```

### Creating a draw

🔒 Finance, AR/AP, Project Manager, Founder

1. **Project → Draws tab → New draw request**
2. Select the loan, enter the amount requested and the request date.
3. Set the **expected funding date** — you can now enter this manually, or let it default to the organisation's standard window.
4. Save as **Draft**.

### Attaching documents — do this before you try to submit

Open the draw. The **document checklist** shows exactly what's needed and what's missing, in red and green:

| Document | Needed to |
|---|---|
| **Sworn statement** | Submit |
| **Vendor invoice** | Submit |
| **Lien waiver** | Approve |
| **Inspection report** | Approve |

Upload each one against its type.

> ⚠️ **The gates are enforced, not advisory.** You physically cannot submit without a sworn statement and vendor invoice, and cannot approve without all four. This exists so nobody discovers a missing lien waiver on the lender's deadline.

### Submitting

Click **Submit**. The draw moves to Submitted and the approvers — Super Admin, Founder, Executive, Finance — are notified.

### Approving internally

🔒 Finance, Founder, Executive, AR/AP *(approval rights)*

1. Open the draw → review the amount and documents.
2. **Approve** (optionally with a comment), **Return for info** (bounces it to Draft), or **Reject** (with a reason).

### Sending to the lender

Once approved, click **Submit to lender** to record that the package went out.

### Marking it funded

When the lender wires the money: **Mark funded**, with the funding date.

### The approval trail

Every action is recorded permanently — who, what, when, and any comment — and shown as a visual stepper on the draw. Four steps are tracked: **Internal Founder → Internal Finance → Lender Submitted → Lender Funded.**

---

## 7.6 When a Draw Is Funded

Marking a draw funded does three things automatically:

1. **Spend records are created** for the funded amount — the money appears in the project's actuals with no re-keying.
2. Dashboards and financial summaries refresh.
3. Finance and leadership are notified.

> This is the loop that closes: request → approve → fund → spend, with no spreadsheet in the middle.

### Overdue funding

If a draw passes its expected funding date without being funded, a daily check flags it — Finance and Founders are notified and it appears in Needs Attention. Chase the lender.

---

## 7.7 Cash Flow

Sidebar → **Cash Flow**. 🔒 Requires financial access.

A forward monthly projection that merges **every** source of money movement into one picture.

**Money coming in:** buyer instalments · lease income · planned loan draws · manual entries.

**Money going out:** loan payments · sub-contractor AP · interior/TI · commissions · miscellaneous.

**Four figures at the top:** Projected Inflow · Projected Outflow · Net Cash Flow · Average Monthly Burn.

**The chart** shows month-by-month inflow, outflow, net, and running cumulative position.

### How things land on the timeline

| Type | When it appears |
|---|---|
| **Recurring** — lease income, loan payments | Spread across every month, with lease escalations applied |
| **Dated** — buyer instalments, planned draws | On their actual date |
| **Owed now** — open vendor commitments, interior invoices, unpaid commissions | **In the first month**, because that's near-term cash need |

That last rule is what makes the projection answer *"how much cash do I need in the next two to four weeks?"* rather than just *"what's the annual picture?"*

You can view a single project or the whole portfolio. Horizon defaults to 12 months.

---

## 7.8 Receivables — Money Coming In

Sidebar → **Receivables**. 🔒 Finance, Accounting, AR/AP, Project Manager.

Every buyer instalment approaching or past due, in one worklist.

**Four cards:** **Total Outstanding** · **Overdue** (past due date) · **Due This Week** (within 7 days) · **High Priority**.

**Filter by:** time window, status, project.

**Each row:** buyer, project, instalment label, due date, amount, amount already paid, and **outstanding balance**.

You can log a payment directly from here.

> 💡 Work this screen every Monday. Sorted by due date, it *is* your collections list.

---

## 7.9 Investors

Sidebar → **Investors**. 🔒 Finance, Founder, Executive can view; Finance and Founder can manage.

- **Investor list** with a portfolio equity summary
- **Equity positions** — ownership percentage per project
- **Capital calls** — issue a call, track it as Pending → Paid, or flag it Overdue
- **Distributions** — record payouts

Open an investor to see their positions, call history and distribution history in one place. Outstanding capital calls show on the Finance Dashboard.

---
---

# Part 8 — Construction

## 8.1 Milestones

**Project → Milestones tab.**

### Adding a milestone

🔒 Project Manager, Construction, Founder, Finance

1. **Milestones tab → Add milestone**
2. Title, description, start date, due date, status.
3. Save.

**Statuses:** Not Started · In Progress · Completed · Overdue · Blocked.

### Dependencies

Set **"depends on"** to say that one milestone can't start until another finishes.

- Prime Tracker checks for circular dependencies and refuses to create a loop.
- A milestone whose prerequisite isn't done shows as blocked.

### Progress photos

Open a milestone → **Add photos**. They appear as a strip on the milestone and are the visual proof of progress.

### Overdue detection

A check runs **every midnight** and flips anything past its due date to **Overdue**, notifies the right people, and adds it to Needs Attention. You don't have to mark it yourself.

### Milestones that trigger money

Two powerful links:

- **Link a milestone to a planned draw.** Completing the milestone **automatically creates a draft draw request** — ready for you to attach documents and submit.
- **Link a milestone to a buyer instalment.** Completing the milestone stamps the due date and flips that instalment to **Due**, so it appears in Receivables.

> 💡 This is the single biggest time-saver in the platform. Marking one milestone complete can simultaneously start a draw request and trigger a buyer payment.

---

## 8.2 Daily Construction Logs

The replacement for site updates disappearing into WhatsApp.

🔒 **Write:** Construction, Project Manager. **Read:** everyone, including Viewers.

### Writing a log

1. **Project (or Building) → Daily log → Add entry**
2. Set the **date** the work happened (not necessarily today).
3. Optionally pick a specific building.
4. Write what happened on site.
5. **Add photos** — as many as you like.
6. Save.

### Reading the feed

Logs appear newest-first with author, date, narrative and a photo grid. Recent logs also surface on the Construction Dashboard, so leadership can see site progress without asking.

> 💡 A short log every day beats a detailed one every fortnight. Photos matter more than prose — they're what settle disputes later.

---

## 8.3 Vendors & Contracts

**Project → Vendors tab.**

### The vendor master

🔒 Project Manager, Finance, Founder

Add each vendor once with their details. If QuickBooks is connected, vendors can be mapped across.

### Contracts

1. **Vendors tab → Add contract**
2. Vendor, scope, contract value, dates, status (Draft · Active · Completed · Terminated).
3. Save.

### Change orders

1. Open the contract → **Add change order**
2. Description and amount.
3. It starts as **Pending**. Someone with rights then **Approves** or **Rejects** it.
4. Approving adjusts the contract's revised value.

### Contract payments

Record payments against a contract. The contract shows **paid vs. remaining** at all times.

Open commitment balances flow into the **Sub-contractor AP** bucket in the cash-flow view — so what you owe vendors is never invisible.

---
---

# Part 9 — Interior / Fit-Out

Sidebar → **Interior**. 🔒 Requires interior access — Project Manager, Construction, Finance, Accounting, AR/AP, Founder, Executive.

A fit-out is the interior work on a unit (or a whole building) after the shell is finished. It has its own budget, its own sub-contractors, its own snag list, and a formal handover. The client-facing price sits on the sale as an instalment, so the operational work and the billing stay separate.

---

## 9.1 The Portfolio Screen

Four cards: **Active fit-outs · Contract value · Spend to date · Handover ≤ 30 days.**

Each fit-out card shows its unit/building, current phase, contract value, spend, and target handover date.

---

## 9.2 Creating a Fit-Out

🔒 `interior:edit` — Project Manager, Founder, Super Admin

1. **Interior → New fit-out**
2. Attach to a **unit or a building**.
3. Optionally link the **sale** or **lease** it belongs to.
4. Assign a **Project Manager**.
5. Choose the **contract type**:

| Type | How value is calculated |
|---|---|
| **Per sqft** *(Prime's default)* | Rate per sqft × area |
| **Fixed** | A flat contract value |
| **Cost plus** | Cost plus margin |

6. Enter rate and area (or the fixed value), start date and target handover.
7. Optionally apply a **package template** to pre-fill the standard scope items.
8. Save.

---

## 9.3 The Seven Phases

```
Design → Client Approval → City Approval ┊ Procurement → Execution → Snagging → Handover
                                          ┊
        everything left of the line may overlap the tail of shell construction
        everything right of the line requires the shell to be finished
```

**To move forward:** open the fit-out → **Advance phase**.

### The three rules that can stop you

**1. One step at a time, forwards only.**
You cannot skip a phase or go back.
> *"Cannot advance from Design to Execution — phases are linear and forward-only."*

To pause, don't try to reverse — set the **status** to **On Hold** instead. Statuses (Not Started · In Progress · On Hold · Completed · Cancelled) are separate from phases.

**2. The shell must be complete for Procurement and Execution.**
The building must have reached Lease-Up, Stabilised, or Sold/Refi.
> This is Prime's "no parallel work" rule, enforced. You cannot start procuring or executing fit-out on a building that's still under construction.

**3. Some phases need a document on file first.**

| To enter | You must have uploaded |
|---|---|
| **Execution** | A **City Approval** document |
| **Handover** | A **Handover Certificate** |

> *"Cannot enter Execution: a City Approval document must be on file first."*

A small chip on the phase stepper shows gate status before you try, so you can see what's missing in advance.

### The approval steps

**Client approval** and **City approval** are recorded with the **Approve client** / **Approve city** buttons.

🔒 These need **interior approval rights** — Founder or Executive.

---

## 9.4 Scope / Bill of Quantities

Open a fit-out → **Scope / BOQ** tab.

**Add line items** with description, category, quantity, unit price and total. This is your BOQ.

> 💡 If Prime does the same fit-out repeatedly, ask your Administrator to save it as a **package template**. Then a new fit-out starts with the whole scope pre-loaded instead of thirty lines of typing.

---

## 9.5 Sub-Contractor Invoices

Open a fit-out → **Invoices** tab → **Add invoice**.

🔒 Requires **interior finance** rights — Finance, Accounting, AR/AP, Project Manager.

Enter vendor, amount, invoice number and invoice date. Status runs **Pending → Approved → Paid**.

Invoices roll into: the fit-out's spend-to-date, the **TI budget used** bar, and the **TI / Interior** bucket in cash flow. Interior spend stays isolated from shell construction spend.

---

## 9.6 Snags (Punch List)

Open a fit-out → **Snags** tab → **Add snag**.

Description, location, who's responsible, due date. Status runs **Open → In Progress → Resolved**.

The tab label shows the number of unresolved snags, so you always know what's outstanding. **Overdue snags trigger a notification.**

> 💡 Raise snags during the walk-through, on the spot, one per item. A snag list written from memory afterwards is always incomplete.

---

## 9.7 Handover

The final phase, and the one with the most riding on it.

1. Upload the **Handover Certificate** document.
2. **Advance phase** to Handover.
3. Record the **client representative who signed off** and any notes.

**What happens:** the fit-out completes — and if the sale has an **On Handover** instalment, **it flips to Due automatically** and appears in Receivables. That's how the fit-out portion actually gets billed.

You'll be notified when a handover is approaching.

---
---

# Part 10 — Documents, Comments & Tasks

## 10.1 Documents

**Project → Documents tab**, or the Documents section of a building, unit or fit-out.

### Uploading

🔒 Most roles can upload — Project Manager, Construction, Finance, Accounting, AR/AP, Sales, Marketing, Legal.

1. **Documents → Upload**
2. Choose the file.
3. Pick a **category**:

| Group | Categories |
|---|---|
| General | General · Permit · Contract · Financial · Drawing · Photo · Legal |
| Sales | Brochure · LOI · Deed |
| Buyer-facing | Booking Agreement · Receipt · NOC · Possession Certificate |
| Interior gates | **City Approval** · **Handover Certificate** |

4. Upload.

Files go straight to secure storage — they don't route through the app, so large files upload quickly.

### Replacing a file (versioning)

Open the document → **Replace file**. The old version is kept in history. **Never delete-and-re-upload** — that loses the trail.

### Renaming

Open the document → **Rename**. This also works for documents attached to a draw request.

### Categories that unlock workflows

Two categories are load-bearing:
- **City Approval** — required before a fit-out can enter Execution
- **Handover Certificate** — required before a fit-out can enter Handover

Uploading with the wrong category means the gate won't open. Pick carefully.

### Link instead of upload

If a document lives elsewhere, you can record it as an external link rather than a file.

---

## 10.2 Comments

Comments exist at **project level** and **unit level**, and always carry a type.

| Type | Colour |
|---|---|
| **Marketing** | Purple |
| **Sales** | Blue |
| **Financial** | Green |

Comments always display in that order — **Marketing, then Sales, then Financial** — newest first within each group. Everywhere, consistently.

### Adding a comment

**On a project:** Project → Comments tab → type your comment → **choose the type** → post.
**On a unit:** Units tab → the comment icon on a unit, or the unit's own page.

> 💡 **Always set the type.** It controls who gets notified and where the comment surfaces. An untyped comment defaults to Marketing, which may not reach the right people.

### Where comments appear

1. Your dashboard — recent comments across the portfolio, grouped by type
2. The project's Comments tab, with filter chips per type
3. The unit comment modal on the Units tab
4. The unit's own detail page

---

## 10.3 Tasks

Sidebar → **Tasks** for everything, or **Project → Tasks tab**.

### Creating a task

🔒 Nearly every role can create and edit tasks — this is the shared coordination surface.

1. **Add task**
2. Title, description.
3. Scope it to a **project**, and optionally a **building** or **unit**.
4. **Assign** it to someone.
5. **Priority:** Low · Medium · High · Urgent.
6. **Due date**.
7. Save.

**Statuses:** To Do · In Progress · Done · Cancelled.

### Discussion and files

Open a task to add **comments** or attach **files**. Use this rather than email when the conversation is about a specific piece of work — it stays with the task.

---
---

# Part 11 — Reports

## 11.1 The Reports Screen

Sidebar → **Reports**. Four tabs; you see the ones your role allows. Everything filters by project.

### Executive Summary
🔒 Founder, Executive, Finance, Accounting, Project Manager
**Total Investment · Total Revenue · Overall ROI · Closed Sales**

### Sales Report
🔒 Founder, Executive, Sales, Marketing
**Total Pipeline · Closed Value · Conversion Rate · Average Days to Close**

### Revenue & Leasing
🔒 Founder, Executive, Finance, Sales
**Monthly Rent · Annual Rent · Active Leases · Occupancy**

### Debt & Financing
🔒 Founder, Executive, Finance
**Total Principal · Total Balance · Weighted Average Rate · Monthly Payments**

---

## 11.2 Role Report Pages

Pre-built views for each function: **Founder Reports · Sales Reports · Construction Reports**. Reach them from the Reports item in the sidebar.

---

## 11.3 Vacancy Report

🔒 Requires sales view access.

Every available unit with **how long it has been on the market**, filterable by project and minimum days vacant (default 90).

> 💡 This is your stale-inventory worklist. If something has been sitting 200 days, the price is wrong, the marketing is wrong, or the unit has a problem. The report tells you which units to have that conversation about.

---
---

# Part 12 — Settings & Administration

## 12.1 Your Own Settings

**Settings → Notifications** — switch each notification type on or off.

**Your avatar menu** — profile, MFA setup, sign out.

---

## 12.2 Admin

🔒 Super Admin and Founder. Sidebar → **Admin**. Five tabs.

### Users

- **Add user** — name, email, password, role. They then sign in with Google.
- **Change role** — change someone's primary role.
- **Assign multiple roles** — a person can hold more than one role. They get the **combined** permissions of all of them.
- **Activate / deactivate** — deactivating blocks sign-in immediately without deleting anything.

### Roles

A read-only matrix of every role and exactly what it can do, grouped into thirteen categories. Use it to answer "why can't Sales see X?" without guessing.

Roles themselves are defined in code, not editable here — this guarantees the app and the documentation can never disagree.

### Options — the customisation tab

This is where you extend Prime Tracker's dropdowns **without a developer**.

**You can customise:** project status · project phase · unit status · unit type · sale status · lead status · milestone status · lease status · task status · task priority · budget category · loan type.

**To add an option:**
1. **Admin → Options** → pick the category
2. **Add option** → value, display label, colour
3. Set a sort order → Save

It appears in every relevant dropdown immediately.

**Rules:**
- **Built-in options cannot be deleted** — only your own additions can. Built-ins are marked as system options.
- **Deleting deactivates rather than erases** — existing records keep their value; the option just stops appearing in new dropdowns.
- **Do not remove the "Other" budget category.** QuickBooks assigns unmapped transactions to it.

> ⚠️ **What you cannot change here.** Workflow-critical values — draw statuses, interior phases, payment triggers, notification types, document categories — are fixed. They drive the approval gates and automations, so changing them would break the workflow. Everything that's just a label is customisable; everything that's machinery is not.

### Integrations — QuickBooks

- **Connect** — starts the QuickBooks authorisation flow
- **Status** — whether the connection is live
- **Sync now** — pulls vendors, bills and payments
- **Sync log** — the last 20 runs and their results
- **Project mappings** — map QuickBooks classes/locations to Prime Tracker projects, so bills land on the right project

> Transactions that can't be matched to a project land in the **Unmapped actuals** list for manual assignment.

### Audit Log

A complete, permanent record of every action in the system — who, what, when, before and after. Covers creates, updates, deletes, logins, logouts, MFA verifications, exports, QuickBooks syncs and role changes.

Nothing can be edited or removed from the audit log by anyone, including Super Admins.

---

## 12.3 Organisations

Prime runs a **US entity** and an **India entity** as separate organisations, each with its own members and its own settings.

Administrators can set per-organisation thresholds that drive the whole platform:

| Setting | Default | Controls |
|---|---|---|
| Sale stage probabilities | 10/35/75/100 % | The weighted forecast |
| Stale unit threshold | 90 days | Stale alerts, health penalty, vacancy report |
| Budget variance alert | 10 % | Variance warnings |
| Sale stage age alert | 30 days | "Deal stuck in stage" flag |
| Sale activity drought | 14 days | Stale deal flag |
| Draw funding window | 14 days | Default expected funding date |
| **Discount approval threshold** | **5 %** | **When a sale needs Founder sign-off** |

---
---

# Part 13 — What Can I Do? Role Quick Reference

## Founder / Executive

**See:** everything.
**Do:** everything except system configuration (Founder). Executives read everything and hold approval authority.

**Your unique responsibilities — nobody else can do these:**
- **Approve discounted sales** over the 5 % threshold
- **Approve draw requests** internally
- **Approve interior client and city gates**
- View the **project Activity log** (Founder & Super Admin only)

**Start your day at:** Founder Dashboard → **Pending approvals**, then **Needs Attention**.

---

## Finance

**See:** all financial data across the portfolio.
**Do:** budgets, actuals, loans, draws (create *and* approve), investors, QuickBooks, interior invoices, payment logging, receivables.
**Cannot:** edit sales or leads, edit milestones, run campaigns.

**Your daily loop:** Finance Dashboard → **Receivables** → **Draws awaiting action** → **Budget variance alerts**.

---

## Accounting

**See:** budgets, actuals, financial reports.
**Do:** budget and actual management, QuickBooks sync, interior invoices, payment logging.
**Cannot:** edit loans, approve draws, manage investors.

---

## AR / AP

**Do:** prepare draw requests and upload their supporting documents, approve payments, enter actuals, log interior invoices and buyer payments.
**Cannot:** edit budgets, touch sales, run reports.

**Your core job:** get draw packages complete. Open each draw and clear its document checklist before submitting.

---

## Project Manager

**See:** **only projects you have been added to.**
**Do:** projects, buildings, units, milestones, vendors, contracts, draws, interior (including invoices), daily logs, documents, tasks.
**See the budget** — but **not** detailed financials (no actuals, no cash-flow module, no financial reports).

> If a project is missing from your list, ask to be added to its team on the Overview tab.

---

## Construction

**See:** **only projects you have been added to**, and **no financial data whatsoever** — no budgets, no spend, no variance, anywhere.
**Do:** milestones, daily logs (this is your main tool), documents, tasks. View vendors and draws for the inspection workflow.

**Your daily loop:** post a daily log with photos, update milestone progress, upload milestone photos.

---

## Sales

**See:** only your assigned projects.
**Do:** sales pipeline, leases, the full lead lifecycle including **converting leads to sales** (only Sales can do this), edit units, manage brokers, view campaigns.
**Cannot:** create campaigns or record marketing spend, see financial data, **combine units**.

**Your daily loop:** Sales Dashboard → **stale deals** → **lead follow-ups** → update the pipeline.

---

## Marketing

**See:** only your assigned projects.
**Do:** **own the campaigns module** — create, edit, record spend, delete. Manage leads. Manage brokers. Edit leases and units.
**Cannot:** **convert a lead to a sale** (that's Sales), see financial data.

**Your daily loop:** record spend → check CPL, CPA and ROI per campaign → make sure every new lead has a source and campaign attached.

---

## Legal

**See:** projects, buildings, units, contracts, sales, leases, loans and documents. **No financial data at all.**
**Do:** view everything above, upload documents, comment.

---

## Viewer

**See:** projects, buildings, units, milestones, comments and daily logs — read-only.
**Do:** nothing that changes data.

---

## Super Admin

Everything, plus system configuration and role management. The only role that can change system-level settings.

---
---

# Part 14 — Troubleshooting & FAQ

## Signing in

| Problem | What to do |
|---|---|
| "Access denied" after Google sign-in | Your account isn't in Prime Tracker, or has been deactivated. Contact your Administrator. |
| Google rejects your email | You must use your **@primedevelopers.com** account. Personal Gmail won't work. |
| Blank screen after signing in | Refresh. If it persists, sign out and back in. |
| Signed out unexpectedly | You were inactive more than 7 days. Sign in again. |
| MFA code rejected | Set your phone's clock to **automatic/network time**. Codes expire every 30 seconds. |
| Lost your authenticator phone | Contact your Administrator to reset MFA. |

## "I can't see something"

| Problem | Almost always because |
|---|---|
| A project is missing from your list | You're a PM / Construction / Sales / Marketing user and haven't been added to that project's team. Ask to be added on the Overview tab. |
| A tab isn't showing on a project | Your role doesn't have access to it. See [Part 13](#part-13--what-can-i-do-role-quick-reference). |
| Budget or spend figures are missing | **Construction** sees no financial data at all. **PM** sees budget but not detailed financials. **Legal** sees no financial data. This is intentional. |
| A sidebar item is missing | Your role doesn't have that module. |
| A button is greyed out | Your role lacks that specific permission. |

## "It won't let me save"

| Message | Why | Fix |
|---|---|---|
| Sale must reference either a unit or a building | You picked both or neither | Pick exactly one |
| Discount needs approval | Over the 5 % threshold | Ask a Founder to **Approve discount** |
| Cannot combine units with attached sales, active leases, or interior projects | Encumbered units | Close or detach those first |
| Unit number already exists | Another live unit in that building has it | Choose a different number (try `101+102`) |
| Missing required documents *(draw)* | Checklist incomplete | Upload sworn statement + vendor invoice to submit; add lien waiver + inspection report to approve |
| Cannot advance — phases are linear and forward-only | You tried to skip or reverse | Advance one step at a time; to pause, set status to **On Hold** |
| Cannot enter Execution: City Approval document required | Gate not satisfied | Upload a document with category **City Approval** |
| Cannot enter Handover: Handover Certificate required | Gate not satisfied | Upload a document with category **Handover Certificate** |
| Shell not complete | The building hasn't reached Lease-Up or later | Fit-out procurement/execution can't run in parallel with shell construction |
| A milestone dependency loop | Circular dependency | Rework the chain |
| Sales role cannot combine units | Role restriction | Ask a PM or Founder |
| Only one active lease per unit | Existing active lease | End it first |

## Common questions

**Can I undo a delete?**
Nothing is truly deleted — records are archived. Ask an Administrator; the audit log shows exactly what happened.

**Why do I see two different revenue numbers?**
**Total pipeline** is every open deal at full value. **Weighted forecast** discounts each deal by its stage probability. The weighted number is the realistic one. See [5.3](#53-the-weighted-forecast--why-two-numbers).

**Why did a unit change status without me doing it?**
Closing a sale sets the unit to Sold. Cancelling a sale releases a reserved unit back to Available. Both are automatic.

**Why did a draw request appear that I didn't create?**
A milestone linked to a draw schedule was marked complete, so Prime Tracker created the draft for you.

**Why did a buyer instalment suddenly become due?**
Either its linked milestone was completed, or the linked fit-out reached Handover.

**Can I add a new status or category?**
Yes, for labels — Administrators can add options under **Admin → Options**. No, for workflow machinery like draw statuses and interior phases.

**Who gets notified when I comment?**
It depends on the type you choose — Marketing, Sales or Financial. Always set it.

**When do the daily checks run?**
**8:00 AM Central** for the notification digest, stale checks and variance alerts. **Midnight** for milestone overdue detection.

**Can brokers log in?**
No. Broker tracking is internal only.

**Does deleting a document lose the old version?**
Use **Replace file** instead of delete-and-re-upload. Replace keeps the version history.

---
---

# Part 15 — Glossary

| Term | Meaning |
|---|---|
| **Absorption** | The rate at which units are sold or leased. The basis of the health score. |
| **Actual** | Money actually spent. |
| **BOQ** | Bill of Quantities — the itemised scope of a fit-out. |
| **Change order** | A formal change to a vendor contract's scope or value. |
| **Commitment** | Money contractually promised but not yet spent. |
| **CPL / CPA** | Cost Per Lead / Cost Per Acquisition. |
| **Draw request** | A request to a lender to release construction loan funds. |
| **Escalation** | A scheduled rent increase on a lease. |
| **Fit-out / TI** | Interior work after the shell is complete. TI = Tenant Improvement. |
| **Health score** | 0–100 unit-absorption score shown as a ring. |
| **Lien waiver** | A document confirming a contractor has been paid and waives lien rights. Required to approve a draw. |
| **LOI** | Letter of Intent — a non-binding step before a contract. |
| **LOT** | A building type for raw land sold by acreage, with no units inside. |
| **Milestone** | A dated construction checkpoint; can trigger draws and buyer payments. |
| **Needs Attention** | The live feed of overdue, stale and at-risk items. |
| **Owner Occupied** | A lease status for space Prime uses itself — neither vacant nor income. |
| **Rent roll** | The list of every active lease and its rent. |
| **Shell** | The base building, before interior fit-out. |
| **Snag** | A defect found during the fit-out walk-through. Also "punch list item". |
| **Sworn statement** | A contractor's sworn account of amounts due. Required to submit a draw. |
| **Time on market** | How long a unit has been Available. Over 90 days is "stale". |
| **Variance** | The gap between budget and actual + committed. |
| **Weighted forecast** | Pipeline revenue adjusted by each stage's probability of closing. |

---

## Getting Help

1. Check [Part 14 — Troubleshooting & FAQ](#part-14--troubleshooting--faq). Most "it's broken" turns out to be a permission or a gate working as designed.
2. Check [Part 13](#part-13--what-can-i-do-role-quick-reference) to confirm your role should be able to do it.
3. Ask your Administrator — they can check the audit log to see exactly what happened.

---

*Last updated 28 July 2026. If a screen in the app doesn't match this manual, the app is right and this document needs updating — please flag it.*
