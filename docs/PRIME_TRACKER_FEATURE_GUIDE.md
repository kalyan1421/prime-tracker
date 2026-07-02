# Prime Tracker — Complete Feature Guide

> Internal platform for Prime Developers | Version: June 2026
> This guide covers every screen, tab, and feature in the application.

---

## Table of Contents

1. [Login & Authentication](#login--authentication)
2. [Role Dashboards](#role-dashboards)
3. [Projects](#projects)
4. [Project Detail — Overview](#project-detail--overview)
5. [Project Detail — Construction Tab](#project-detail--construction-tab)
6. [Project Detail — Revenue Tab](#project-detail--revenue-tab)
7. [Project Detail — Units Tab](#project-detail--units-tab)
8. [Project Detail — Milestones Tab](#project-detail--milestones-tab)
9. [Project Detail — Leads Tab](#project-detail--leads-tab)
10. [Project Detail — Draws Tab](#project-detail--draws-tab)
11. [Project Detail — Vendors Tab](#project-detail--vendors-tab)
12. [Project Detail — Documents Tab](#project-detail--documents-tab)
13. [Project Detail — Tasks Tab](#project-detail--tasks-tab)
14. [Project Detail — Comments Tab](#project-detail--comments-tab)
15. [Unit Detail Page](#unit-detail-page)
16. [Inventory](#inventory)
17. [Leads (Global View)](#leads-global-view)
18. [Campaigns & Marketing](#campaigns--marketing)
19. [Investors](#investors)
20. [Tasks (Global View)](#tasks-global-view)
21. [Reports](#reports)
22. [Notification Settings](#notification-settings)
23. [Admin — User Management](#admin--user-management)

---

## Login & Authentication

Prime Tracker uses your company Google account to keep access secure and simple. There are no separate passwords to remember — just your existing **@primedevelopers.com** email.

---

### Signing In

**Who can sign in:** Anyone with an active **@primedevelopers.com** Google Workspace account who has been added to Prime Tracker by an Administrator.

**Steps to sign in:**

1. Open Prime Tracker in your browser.
2. Click the **"Sign in with Google"** button on the login page.
3. A Google sign-in prompt will appear. Select or enter your **@primedevelopers.com** email address.
4. Complete Google's standard sign-in (password, Google MFA if your Google account requires it).
5. You will be taken directly to your role-based dashboard.

**Important:** Only **@primedevelopers.com** email addresses are accepted. Personal Gmail accounts or other company emails will be rejected. If you see an error after signing in with Google, contact your Administrator to confirm your account has been added to the system.

---

### Your Session — How It Works

Once signed in, Prime Tracker manages your session automatically in the background. You do not need to do anything.

- **Active session:** You stay logged in as long as you are using the app. Prime Tracker quietly refreshes your session every 15 minutes behind the scenes.
- **Session length:** If you close the browser or stop using the app, your session remains valid for up to **7 days**. Returning within that window brings you straight back in without signing in again.
- **Session expiry:** After 7 days of inactivity, your session expires. You will be redirected to the login page automatically and will need to sign in again with Google.

There is nothing you need to manage — session handling is fully automatic.

---

### Multi-Factor Authentication (MFA) — Founder & Finance Roles

To protect sensitive financial data, **MFA is required for all Founder and Finance users**. MFA adds a second verification step using an authenticator app on your phone (such as Google Authenticator, Authy, or Microsoft Authenticator).

**Who must set up MFA:** Users with the **Founder** or **Finance** role. Other roles are not required to use MFA, though it may become available to all users in a future update.

#### Setting Up MFA for the First Time

1. After signing in, you will see a banner or prompt reminding you to set up MFA. You can also access the setup from your **user menu** in the top-right corner of the app.
2. Click **"Set up MFA"** to begin. A 4-step guided flow will appear:
   - **Step 1 — Introduction:** A brief explanation of what MFA is and why it is required.
   - **Step 2 — Scan QR Code:** Open your authenticator app on your phone and scan the QR code shown on screen. This links your authenticator app to your Prime Tracker account.
   - **Step 3 — Verify:** Enter the 6-digit code currently displayed in your authenticator app to confirm the link worked correctly.
   - **Step 4 — Done:** MFA is now active on your account.
3. From this point forward, you will be asked to enter a 6-digit code from your authenticator app each time you sign in.

#### Using MFA to Sign In (After Setup)

1. Sign in with Google as normal.
2. When prompted, open your authenticator app and enter the current 6-digit code.
3. The code refreshes every 30 seconds — enter it before it expires.
4. Once verified, you are taken to your dashboard.

#### If You Lose Access to Your Authenticator App

If you lose your phone or can no longer access your authenticator app, contact your **Administrator** immediately. They can reset your MFA so you can set it up again on a new device. You will not be able to sign in without completing MFA verification.

---

### Common Sign-In Issues

| Situation | What to Do |
|---|---|
| "Access denied" after signing in with Google | Your account may not be added to Prime Tracker yet. Contact your Administrator. |
| Signed in but see a blank screen or loading error | Refresh the page. If it persists, sign out and sign back in. |
| MFA code is rejected | Make sure your phone's clock is set to automatic/network time. MFA codes are time-sensitive. |
| Session expired unexpectedly | You were inactive for more than 7 days. Sign in again with Google. |
| Cannot see the MFA setup prompt (Founder/Finance) | Look for a banner at the top of your dashboard, or check your user menu in the top-right corner. |

---

### Signing Out

To sign out manually, click your **name or avatar** in the top-right corner of the app and select **"Sign out."** This immediately ends your session. You will be redirected to the login page.

---

## Role Dashboards

Prime Tracker automatically routes each team member to the dashboard that matches their role the moment they log in. You do not need to choose or navigate — the system delivers the right view immediately.

---

### Which Dashboard Do You See?

| Your Role | Dashboard |
|---|---|
| Founder, Executive, Super Admin | Founder Dashboard |
| Finance, Accounting, AR/AP | Finance Dashboard |
| Sales, Marketing | Sales Dashboard |
| Project Manager, Construction | Construction Dashboard |
| All other roles (Viewer, Legal, etc.) | Portfolio Dashboard (general) |

---

### Portfolio Dashboard

**Who sees it:** All roles, including Viewer and Legal.

**What it shows:** A high-level overview of everything happening across all projects.

#### Construction Health
Shows four numbers at a glance: **Total Budget**, **Total Actuals**, **Committed**, and **Budget Variance** (green if under budget, red if over).

#### Monthly Cash Flow
Shows three figures: **Lease Income**, **Debt Service**, and **Net Cash Flow** (green means positive, red means negative).

#### Sales and Availability
A four-number panel showing **Units Available**, **Under Contract**, **Leased**, and **Sold**. Sales and Marketing roles also see **Active Leads** and **Total Leads**.

#### Charts
- **Projects by Phase** (pie chart) — shows how many projects are in each stage
- **Units by Status** (bar chart) — shows the count of units in each status across the entire portfolio

#### Alerts
A scrollable list of active alerts across all projects, color-coded by severity: Critical (red), High (orange), Medium (yellow), Low (blue). Click any alert to jump to that project.

#### Upcoming Milestones
A table showing the next milestones due across all projects. Click any row to open that project's Milestones tab.

#### Recent Comments
Grouped by type in a fixed order — **Marketing** (purple), then **Sales** (blue), then **Financial** (green). Click any comment to jump to the project or unit it belongs to.

---

### Founder Dashboard

**Who sees it:** Founders, Executives, and Super Admins only.

**What it shows:** A full portfolio command center — financials, construction status, sales pipeline, overdue items, exceptions, and team activity.

#### Portfolio Health Bar
Five cards at the top: **Total Projects**, **Active Projects**, **Budget Utilization**, **Net Monthly Cash Flow**, and **Loan Book Total**.

#### Construction Financials
A four-number panel (amber header): **Total Budget**, **Total Actuals**, **Budget Variance**, and **Total Loan Available** with monthly debt service.

#### Sales and Marketing Financials
A four-number panel (blue header): **Closed Sales YTD**, **Projected Unsold Value**, **Under Contract Value**, and **Monthly Lease Income** with its annual equivalent.

#### Charts
- **Projects by Phase** (pie chart) — portfolio split by development stage
- **Units by Status** (bar chart) — unit counts by status across all projects

#### Overdue Milestones
A table of every milestone currently marked Overdue. Click any row to go to that project's Milestones tab.

#### Portfolio Exceptions
A live feed of delays, blockers, and risks sorted by severity. Click any item to navigate to the relevant project.

#### Unsold Units by Project and Building
A hierarchical table showing, for each project and building: units available, combined estimated value, and units under contract with their contract value.

#### Recent Comments
The last 20 comments across all projects, grouped by type with colored section headers.

---

### Finance Dashboard

**Who sees it:** Finance, Accounting, AR/AP, and leadership.

**What it shows:** A financial control panel — budget tracking, draw requests, loan maturities, and project-by-project variance.

#### Portfolio Financial Health
Four summary cards: **Total Budget**, **Total Actuals**, **Budget Variance**, and **Total Loan Book**.

#### Pending Draw Requests
Two figures: **Pending Count** (orange when open items exist) and **Pending Amount**.

#### Loans Maturing in 90 Days
A scrollable list of every loan coming due within 90 days, highlighted in red. Click any row to open that project's financials.

#### Budget vs Actuals by Category
A bar chart comparing budgeted versus actual spend, broken down by budget category.

#### Budget Variance by Project
A detailed table showing every project with Phase, Budget, Actuals, Variance, a progress bar (orange above 90%, red above 100%), and pending draw count.

---

### Sales Dashboard

**Who sees it:** Sales and Marketing roles only.

**What it shows:** A sales and leasing command center — unit inventory, pipeline stages, lead activity, and revenue by project.

#### Top Summary Cards
Six figures: **Available Units**, **Under Contract**, **Total Pipeline**, **Closed Sales YTD**, **Monthly Lease Income**, and **Active Leads**. Each card is clickable and links to the relevant report or list.

#### Sales Pipeline by Stage
A bar chart showing deal counts by stage: Prospect, LOI Signed, Under Contract, and Closed.

#### Lead Stats
Four mini-cards: **Total Leads**, **Active Leads**, **Converted This Month**, and **Under Contract** unit count.

#### Revenue by Project
A table listing each project with Available, Under Contract, Leased, and Sold unit counts. Click any row to open that project's Units tab.

#### Unit Inventory by Project
A stacked bar chart showing, for each project, unit counts by status.

---

### Construction Dashboard

**Who sees it:** Project Managers and Construction roles.

**What it shows:** A project execution tracker — active projects, milestone status, budget progress, and draw requests.

**Note on financial data:** Construction team members do not see budget amounts — they see milestone and schedule information only. Project Managers also see financial figures.

#### Summary Cards
Four cards: **Active Projects**, **Overdue Milestones** (red when any exist), **In-Progress Milestones**, and **Budget Spent**.

#### Project Status Board
A table with one row per active project showing Phase, Budget Spent (Project Managers only), Overdue count, In-Progress count, and Done count. Click any row to open that project.

#### Overdue Milestones Detail
A table listing every overdue milestone with its name, project, and how late it is. Click any row to go to that project's Milestones tab.

#### Draw Requests
Two figures: **Pending** (orange) and **Approved** (green).

#### Projects by Phase
A pie chart showing the distribution of active projects across development phases.

#### Recent Milestone Activity
A scrollable table of the most recently updated milestones across all projects. Click any row to go to that project's Milestones tab.

---

## Projects

The Projects page is your central hub for viewing and managing all of Prime Developers' active development projects. From here you can search, filter, and sort across your entire portfolio, switch between card and table views, and create or archive projects.

---

### Who Can See This Page

All team members with a Prime Tracker login can view the Projects page. The actions you can take depend on your role:

- **Creating a new project** — requires the Project Create permission (typically Founders, Executives, and Project Managers)
- **Editing a project** — requires the Project Edit permission
- **Archiving a project** — requires the Project Delete permission

---

### Viewing Your Projects

Two display formats are available:

#### Grid View
A card-based layout showing each project as a visual tile. This is the default view and gives you the most at-a-glance detail per project, including the health score ring, phase progress bar, and budget health.

#### List View
A compact horizontal table, useful when you want to scan many projects side by side. Switch between Grid and List using the two icons in the top-right corner of the filter bar.

---

### Searching and Filtering

Above the project list is a filter bar that lets you narrow down which projects appear. All filters work together.

- **Search** — Type part of a project name or location. Results update as you type.
- **Status** — Filter by: Active, On Hold, Completed, or Archived
- **Phase** — Filter by: Pre-Development, Permitting, Construction, Lease Up, Stabilized, or Sold/Refi
- **Type** — Filter by: Residential, Commercial, Mixed Use, or Industrial
- **Sort** — Order by: Name A-Z, Name Z-A, Newest First, Oldest First, or by Phase

#### Showing Archived Projects

By default, archived projects are hidden. Click **Show Archived** to surface them. Click **Clear Filters** to reset all active filters at once.

---

### Understanding the Project Card (Grid View)

Each card shows:

- **Health Score Ring** — overall health of the project across multiple dimensions. Hover for a breakdown.
- **Project Name and Location**
- **Status Badge** — Active, On Hold, Completed, etc.
- **Type Chip** — color-coded label (blue for Residential, green for Commercial, purple for Mixed Use, amber for Industrial)
- **Phase and Phase Progress Bar** — current development phase with a lifecycle progress bar
- **Budget Health Bar** — spending progress; turns amber at 80% and red at 100%
- **Buildings and Units Count**
- **Edit and Archive icons** — visible if you have the appropriate permissions

---

### Creating a New Project

Click **New Project** to open the creation form.

**Required fields:**
- **Project Name** — between 2 and 120 characters
- **Slug** — a URL-friendly identifier using only lowercase letters, numbers, and dashes (max 80 characters)
- **Location** — city, region, or general location

**Optional fields:**
- Address, Project Type, Acreage, Phase, Status, Start Date, Target Completion, Description

Once you fill in the required fields and click **Save**, the project is created immediately.

---

### Archiving a Project

Archiving is a safe operation — **no data is deleted**. When a project is archived:

- Its status is set to **Cancelled**
- All buildings, units, financials, documents, and history are preserved
- The project is hidden from the default project list

To archive, click the **trash icon** on the project card and confirm. The archive icon only appears on projects that are not already Cancelled.

---

## Project Detail — Overview

The Project Detail page is the central hub for everything related to a single project. Open it by clicking any project name from the Projects list.

---

### Project Header

At the top of every Project Detail page is a summary card always visible regardless of which tab you are on.

- **Back arrow** — returns to the Projects list
- **Health Score Ring** — hover for a breakdown of what is affecting the score
- **Project name, location, acreage**
- **Status and Phase badges** — color-coded chips
- **Phase Progress bar** — shows how far along the project is through its lifecycle phases
- **Project Health panel** — shows key numbers: total budget vs. spent, unit counts and occupancy, active leases, loan totals, and an inline phase update control

---

### Tabs — Navigating the Project

Below the header is a tab bar that organizes the project into focused sections. The tabs you see depend on your role.

| Tab | What It Contains | Who Can See It |
|---|---|---|
| **Overview** | Summary cards, phase timeline, team, exceptions | Everyone |
| **Construction** | Buildings and daily construction logs | Project Managers, Finance, Construction, and others |
| **Budget** | Budget lines, actuals, and cost tracking | Founders, Finance, Accounting, AR/AP, Project Managers |
| **Revenue** | Sales pipeline and leases / rent roll | Founders, Finance, Sales, and above |
| **Units** | Unit inventory by building | Everyone |
| **Milestones** | Project milestones and dependencies | Most roles (not Sales, Marketing, or Legal) |
| **Leads** | Lead pipeline for this project | Founders, Sales, Marketing, and above |
| **Draws** | Loan draw requests and approvals | Finance, Accounting, AR/AP, Project Managers |
| **Vendors** | Contracts, vendors, and commitments | Most roles (not Sales, Marketing, or Viewer) |
| **Documents** | Project documents and files | Most roles (not AR/AP or Viewer) |
| **Tasks** | Project tasks and assignments | Everyone |
| **Comments** | Project-level discussion threads | Everyone |

---

### Overview Tab

#### Project Details

A card showing the core facts about the project. Click **Edit** to update name, location, description, address, acreage, project type, status, phase, start date, and target completion.

#### Financial Snapshot

- **Total Budget** — sum of all approved budget lines
- **Total Spent** — sum of all recorded actuals
- **% Spent** — green under 80%, amber 80-99%, red at 100%+
- **Remaining** — budget minus actuals
- **Loans** — each loan listed with type and principal amount

#### Project Phase Timeline

A visual step-by-step indicator showing the six phases:

1. Pre-Development
2. Permitting
3. Construction
4. Lease-Up
5. Stabilized
6. Sold / Refi

Filled blue circle with checkmark = completed phase. White circle with blue border = current phase. Gray circle = upcoming phase.

#### Team Members

Lists everyone assigned to this project. Click **Add Member** (visible to Super Admins, Founders, Executives, and Project Managers) to add a user with their project role (Project Manager, Construction, Finance, Sales, Legal, Viewer, or Team Member). Each member row has a **Remove** button.

#### Exceptions and Blockers

If the project has active exceptions, risks, or blockers, they appear here. If there are no active exceptions, this section is hidden.

---

## Project Detail — Construction Tab

Visible to Project Managers, Construction staff, Finance, and leadership. Not visible to Sales, Marketing, Legal, or Viewer roles.

This tab is split into two sections: **Buildings** and **Daily Logs**.

---

### Buildings

Each building appears as a card in a grid layout showing: building name (click to open Building Detail page), building type, phase, unit count, total square footage, number of stories, and cover photo.

#### Building Types

| Type | Use Case |
|---|---|
| **Residential** | Apartments, condos, townhomes |
| **Commercial** | General commercial space |
| **Mixed Use** | Combination of residential and commercial |
| **Industrial** | Warehouse, manufacturing |
| **Parking** | Stand-alone parking structures |
| **Amenity** | Club house, gym, pool buildings |
| **Retail** | Retail storefronts |
| **Office** | Office buildings |
| **LOT** | Raw land parcels — acreage with no units attached |

#### Searching and Filtering Buildings

A search bar above the cards lets you filter by building name. A building type filter dropdown appears when the project has more than one type.

#### Adding a Building

Click **Add Building** (requires building:edit permission). Fields:
- **Name** (required)
- **Building Type**
- **Total Sqft**
- **Stories**
- **Phase** — Note: The overall project phase is automatically set to match the most-advanced building phase.
- **Cover Photo** — upload an image for the building card

#### Editing and Deleting a Building

Edit: click the pencil icon on the building card.

Delete: click the trash icon. If the building has units attached, a force-delete confirmation checkbox is required before proceeding. Deleting a building with units permanently removes those units.

---

### Daily Logs

The Daily Logs section appears below Buildings. Visible only to users with the **dailylog:view** permission. It displays the running record of on-site construction activity — what happened on site each day, who was there, and what progress was made.

---

## Project Detail — Revenue Tab

**Who can see this tab:** Super Admin, Founder, Executive, Finance, and Sales roles.

Four summary cards at the top give an instant snapshot:
- **Closed Sales** — total dollar value of all completed unit sales
- **Under Contract** — number of deals currently under contract
- **Monthly Lease Income** — total rent collected each month
- **Annual Rent** — monthly lease income multiplied by 12

---

### Sales Pipeline

The Sales Pipeline tracks every unit sale from first conversation through to closing, organized as a **kanban board** with columns for each stage.

#### The Five Pipeline Stages

| Stage | What it means |
|---|---|
| **Prospect** | Initial interest — a potential buyer is being pursued |
| **LOI Signed** | A Letter of Intent has been signed |
| **Under Contract** | A formal purchase contract is in place |
| **Closed** | The sale has been completed |
| **Cancelled** | The deal has been cancelled |

Each column shows a colored header, the number of deals in that stage, and the total dollar value of those deals. Columns can be **collapsed** into a slim vertical rail by clicking on them.

#### Velocity Metrics

When sales exist, four metric cards appear above the board: **Total Pipeline Value**, **Weighted Forecast**, **Avg Days to Close**, and **Total Deals**.

#### Reading a Deal Card

Each card shows buyer name, unit number, and sale price. Click to expand and see:
- Closing Date and Expected Close Date
- Deposit Amount
- Discount warning (amber if below asking; green if approved)
- **Payments button** — opens the Sale Payment Schedule
- **Edit**, **Cancel**, and **Delete** buttons

#### Adding a New Sale

Click **"Add Sale"** and fill in: Unit (required), Buyer, Sale Price, Deposit Amount, Status, LOI Date, Contract Date, Closing Date, Expected Close Date, Broker (optional, shows Commission % field when selected), and Notes.

#### Cancelling a Sale

Click the **X button** on an expanded card. Select a **Lost Reason** (required) and optionally add a reason note before confirming.

#### What Happens When a Sale is Closed

When a sale's status is set to **Closed**, the associated unit's status automatically updates to **Sold**.

---

### Leases / Rent Roll

The Leases section tracks all rental agreements on the project.

#### Rent Roll Summary

Three stat cards: **Active Leases**, **Monthly Rent**, and **Annual Rent**.

#### The Lease Table

| Column | Description |
|---|---|
| **Tenant** | Tenant's name |
| **Unit** | The unit being leased |
| **Monthly Rent** | The agreed monthly rent |
| **Start / End** | Lease dates |
| **Escalation %** | Annual rent increase percentage |
| **Status** | Draft, Active, Expired, or Terminated |
| **Actions** | Edit or delete |

#### Adding a New Lease

Click **"Add Lease"** and fill in: Unit (required — only genuinely available units are shown; units with active/pending leases or Sold units are excluded), Tenant Name (required), Tenant Contact, Monthly Rent (required), Lease Start (required), Lease End (required), Term Months, Escalation %, Security Deposit, Status, and Notes.

**Important:** Once a lease is created, the unit it is attached to cannot be changed. Delete and recreate if you need to move a lease to a different unit.

---

## Project Detail — Units Tab

The Units Tab shows every unit across all buildings in a project — their status, size, pricing, lease info, and more.

---

### Who Can Use This Tab

- **Full Edit access** (Project Managers, Finance, Executives, Founders, Admins): Can create, edit all unit details, and delete units.
- **Sales role**: Can update a unit's **status and notes only** — cannot create or delete units.
- **Construction role**: Can view units but **Asking Price**, **Monthly Rent**, and **Price Per Sq Ft** columns are hidden.

---

### Inventory Heat Map

A row of colored clickable pills shows unit counts by status:

| Status | Color |
|---|---|
| Available | Green |
| Under Contract | Blue |
| Leased | Teal |
| Occupied | Purple |
| Sold | Gray |
| Under Construction | Orange |

Click any pill to filter the unit list to that status. Click again or use "Clear status filter" to show all.

---

### Filters and Search

- **Unit count** — shows units displayed vs. total
- **Search bar** — searches by unit number, tenant name, or notes
- **Building filter dropdown** — appears when the project has more than one building
- **Combine Units** button — merge adjacent units (full edit roles)
- **Add Unit** button — opens the unit creation form (full edit roles)

---

### The Unit List

Units are **grouped by building** in collapsible sections. Each section header shows the building name and unit count. Click the header to collapse or expand.

**Table columns:**

| Column | Description |
|---|---|
| **Unit** | Unit number — click anywhere on the row to open the Unit Detail page |
| **Type** | Unit type |
| **Size** | Square footage |
| **Status** | Current status badge |
| **Prime** | Chip shown if flagged as Prime Developer Owned |
| **Tenant** | Tenant name from the first active lease |
| **Monthly Rent** | Hidden from Construction role |
| **Asking Price** | Hidden from Construction role |
| **PSF** | Asking Price Per Square Foot — hidden from Construction role |
| **Actions** | Comment, Edit, and Delete buttons |

---

### Creating a New Unit

Click **Add Unit**. Fields:

- **Unit Number** (required) — up to 40 characters
- **Building** (required) — cannot be changed after creation
- **Unit Type**
- **Size (sqft)**
- **Status**
- **Asking Rent ($/mo)**
- **Asking Price PSF** — changing this auto-recalculates the total Asking Price
- **Asking Price ($)** — changing this auto-recalculates the PSF
- **Prime Developer Owned** toggle
- **Notes**

**Price / PSF auto-calculation:** Size, Asking Price, and Asking Price PSF stay in sync automatically.

---

### Editing a Unit

**For most roles:** Full form opens; Building field is locked. If the unit has an active lease, a Current Tenant field is also available.

**For the Sales role:** A smaller form opens showing only Status (valid next-step statuses only) and Notes.

---

### Deleting a Unit

Click the delete icon. If the unit has attached leases or sales, a warning shows the count of affected records. You must check an acknowledgment box before the Delete button becomes active.

---

### Commenting on a Unit

Click the comment bubble icon on a unit row to open its comment thread. Select a comment type (Marketing, Sales, or Financial), type your comment, and press Send or Enter.

---

### Key Status Values

| Status | Meaning |
|---|---|
| **Available** | Unit is on the market, not yet committed |
| **Under Contract** | A sale contract is in progress |
| **Leased** | Unit has an active lease |
| **Lease Pending** | A lease has been drafted but not yet active |
| **Sold** | Unit has been sold and closed |
| **Occupied** | Unit is occupied without a formal lease record |
| **Under Construction** | Unit is not yet ready for occupancy |

---

## Project Detail — Milestones Tab

The Milestones Tab gives your team a single place to plan, track, and visualize every key deadline in a project.

---

### The Progress Bar

At the top of the tab: **"X of Y completed (Z%)"** with a colored progress bar.

---

### Timeline View vs. List View

Use the **"Timeline" / "List View"** toggle to switch between two ways of seeing milestones.

#### Timeline (Gantt Chart)

Milestones appear as horizontal bars, color-coded by status:

| Color | Status |
|---|---|
| Slate / gray | Not Started |
| Blue | In Progress |
| Green | Completed |
| Red | Overdue |
| Orange | Blocked |

#### List View (Table)

**Overdue milestones are automatically sorted to the top** and highlighted with a red background.

**Columns:**
- **Milestone** — title; shows "blocked by" chip and photo count chip
- **Owner** — responsible team member with avatar
- **Phase** — project phase this milestone belongs to
- **Due Date** — "+Nd late" chip appears in red if overdue
- **Completed Date**
- **Status** — current status badge
- **Actions** — Edit or Delete

---

### Milestone Statuses

- **Not Started** — Work has not begun
- **In Progress** — Actively being worked on
- **Completed** — Finished
- **Overdue** — Due date passed, not yet complete
- **Blocked** — Cannot proceed due to an incomplete dependency

---

### Milestone Phases

Pre-Development, Permitting, Construction, Lease-Up, Stabilized, Sold / Refi

---

### Adding a Milestone

Click the **Add** button. Required fields: **Title**, **Phase**, **Due Date**.

Optional fields: Description, Status, Owner, Sort Order, **Depends On** (sets a dependency — see below), and **Linked Draw Schedule** (auto-creates a draft draw request when milestone is marked Completed).

---

### Milestone Dependencies

A dependency means one milestone must be finished before another can begin.

**To set a dependency:** Open the Create or Edit form for the waiting milestone. In the **Depends On** field, select the milestone that must be completed first.

**What happens:** The waiting milestone shows a "blocked by [milestone name]" chip in the list view. The system prevents circular dependency loops.

---

### Linking a Milestone to a Draw Schedule

When a milestone is set to **Completed**, the system automatically creates a **Draw Request in draft status** for the linked draw schedule. To link: open the Create or Edit form and select from the **Linked Draw Schedule** dropdown.

---

### Milestone Photos

Open the **Edit** form for a milestone. Scroll to the **photo strip** at the bottom to upload progress photos. The photo count chip in the list view shows how many photos are attached.

---

## Project Detail — Leads Tab

Tracks every prospective buyer or tenant for that project — from first contact through to a closed sale.

---

### The Pipeline Funnel Bar

A color-coded horizontal bar shows lead counts by active stage:
New, Contacted, Potential, Qualified, Site Visit, Proposal Sent, Negotiating.

**Converted** and **Lost** totals are displayed separately.

---

### Filtering and Searching

Four quick-filter tabs: **All**, **Active**, **Converted**, and **Lost**. A **search box** lets you find a lead by name, email, or phone.

---

### The Lead List

Each lead row shows: Name, Status badge (click to quick-change stage), Source, Email, Linked unit, and an idle indicator (amber after 7 days, red after 14 days).

---

### The Activity Side Panel

Click a lead to open its detail panel showing: contact info, budget, linked unit, a **Convert to Sale** button, and an **Activity Timeline**.

**Logging an activity:** Select the type (Call, Email, Meeting, Site Visit, Follow-Up, Note, or Status Change), type a note, and press Enter.

**Automatic stage suggestions:** After logging certain activities, a suggestion banner offers to advance the lead's stage automatically.

---

### Adding a New Lead

Click **New Lead**. Required: **Name**. Optional: Email, Phone, Budget, Source, Status, Unit, Notes on interest, Notes.

**Lead Sources:** Website, Referral, Social Media, Walk-In, Signage, Cold Call, Email Campaign, Broker, LoopNet, Crexi, Other.

---

### Converting a Lead to a Sale

Click **Convert to Sale** in the activity panel. Provide: Unit, Buyer name, Sale price, Contract date, Expected close date. Confirms creates a new Sale record and marks the lead as **Converted**.

---

## Project Detail — Draws Tab

Your central workspace for managing construction loan draw requests — from initial drafting through lender funding.

---

### Summary Cards

- **Total Draws** — count of all draw requests
- **Funded Total** — cumulative dollar amount fully funded
- **Pending** — combined dollar amount of draws in Submitted or Approved status

---

### Draw Status Values

| Status | Meaning |
|---|---|
| **Draft** | Created but not yet submitted |
| **Submitted** | Submitted, awaiting internal approval |
| **Approved** | Internal approvers signed off; ready for lender |
| **Funded** | Lender released the funds |
| **Rejected** | Rejected; a reason is recorded |
| **Cancelled** | Withdrawn before completion |

---

### Creating a Draw Request

Click **New Draw Request**. Select the **Loan**, enter the **Requested Amount** and **Notes**. The draw is created in **Draft** status.

---

### The Draw Approval Workflow

| Step | Who Acts |
|---|---|
| Step 1 — Internal Founder Review | Founder confirms the request is valid |
| Step 2 — Internal Finance Review | Finance reviews; may adjust the Approved Amount |
| Step 3 — Lender Submitted | Draw package formally submitted to the lender |
| Step 4 — Lender Funded | Lender releases funds; draw marked Funded |

To reject a draw, an approver must provide a free-text **Rejection Reason**.

---

### Draw Detail View

Clicking into a draw shows:
- **Status stepper** — visual checklist of approval steps completed vs. pending
- **Workflow action buttons** — to advance, reject, or act on the draw
- **Draw Documents** — supporting files such as lien waivers and inspection reports

---

### Draw Schedule

The Draws tab also surfaces the **Draw Schedule** — the planned schedule of draws tied to project milestones, so Finance can anticipate cash flow needs.

---

### Deleting a Draw

Only draws in **Draft** status can be deleted. A trash icon appears on Draft rows in the table.

---

## Project Detail — Vendors Tab

Your central workspace for tracking every vendor contract — from the initial contract value through change orders and payment history.

---

### The Summary Cards

- **Original Value** — total contracts as originally signed
- **Current (w/ COs)** — running total after approved change orders
- **Paid to Date** — total amount actually paid out
- **% Complete** — overall completion percentage (paid divided by current value)

---

### The Contract List

Each contract row shows: Vendor name, Status badge, Trade label, Description, Original / Current / Paid amounts, % Complete progress bar, and action buttons (**+ CO**, **$ Pay**, and delete icon).

Click the **chevron** on any row to expand it and see the full history of change orders and payments.

---

### Contract Statuses

| Status | What It Means |
|---|---|
| **DRAFT** | Entered but not yet fully executed |
| **ACTIVE** | In force and work is underway |
| **COMPLETED** | All work and payments finished |
| **TERMINATED** | Ended before completion |

---

### Adding a New Contract

Click **"New Contract"**. Fill in: Vendor, Description, Amount, Status, Start Date, End Date. Click **Save**.

---

### Change Orders

**To add a change order:** Click **+ CO** on the contract row. Fill in Description and Amount (positive to add cost, negative to reduce). The change order is created with status **PENDING**.

**To approve or reject:** Click the approve or reject icon buttons next to a PENDING change order in the expanded view. Approving adds the amount to the current contract total.

**Change Order Statuses:** PENDING, APPROVED, REJECTED.

---

### Recording Payments

Click **$ Pay** on the contract row. Fill in: Amount, Date, and Notes. The payment updates the Paid to Date total.

---

## Project Detail — Documents Tab

A centralized file library for the project. All files related to permits, contracts, drawings, photos, legal paperwork, and more are stored here.

---

### Document Categories

| Category | What It's For |
|---|---|
| **General** | Miscellaneous files |
| **Permit** | Building permits and approvals |
| **Contract** | Vendor and construction contracts |
| **Financial** | Budgets, invoices, financial statements |
| **Drawing** | Architectural and engineering drawings |
| **Photo** | Site photos and progress images |
| **Legal** | Legal agreements and compliance files |
| **Brochure** | Marketing brochures and sales materials |
| **LOI** | Letters of Intent |
| **Deed** | Property deeds and ownership records |
| **Booking Agreement** | Buyer or tenant booking agreements |
| **Receipt** | Payment receipts |
| **NOC** | No Objection Certificates |
| **Possession Certificate** | Documents confirming possession handover |

---

### Filtering by Category

A row of category filter buttons at the top: **ALL — GENERAL — PERMIT — CONTRACT — FINANCIAL — DRAWING — PHOTO — LEGAL**. Click any button to filter; click ALL to return.

---

### Document Cards

Documents are displayed as cards showing: file type icon, file name, category badge, file size, who uploaded it and when, and three action buttons — **View** (opens in new tab), **Download**, and **Delete**.

---

### Uploading a Document

1. Click the **Upload** button
2. Select a file from your computer
3. Enter a display name (optional) and choose a category
4. Click **Upload** to confirm

---

### Document Versions

The system supports versioning — upload a newer version without losing the original. Full version history is maintained.

---

## Project Detail — Tasks Tab

Lets your team create, assign, track, and discuss work items within a specific project. Works identically to the standalone Tasks page but scoped to the current project.

---

### Task Statuses

| Status | Meaning |
|---|---|
| **Todo** | Work has not started |
| **In Progress** | Actively being worked on |
| **Done** | Completed |
| **Cancelled** | No longer needed |

---

### Task Priorities

- **Low** — not time-sensitive
- **Medium** — standard priority
- **High** — needs attention soon
- **Urgent** — drop everything

---

### Creating a Task

Click **"New Task"**. Fill in: Title (required), Description, Assignee, Due Date, Priority, and Status. The project is pre-filled.

---

### Filtering and Searching Tasks

Filter bar includes: Search (by title), Status, Priority, and Assignee. A **Clear** button resets all filters.

---

### Viewing Task Details

Click any task row to open a right-side detail panel showing: full title and description, Status, priority, assignee, due date, a **comments thread**, and **Attachments**.

---

## Project Detail — Comments Tab

The central place to capture and review team notes on a project, organized by department.

---

### Comment Types

| Type | Color | Intended Use |
|---|---|---|
| **Marketing** | Purple | Campaign updates, brand decisions, outreach context |
| **Sales** | Blue | Buyer/tenant feedback, pipeline notes, deal context |
| **Financial** | Green | Budget observations, cost notes, accounting flags |

---

### How Comments Are Sorted

Comments always appear in this order: **Marketing** first, **Sales** second, **Financial** third. Within each group, the most recent comment appears at the top.

---

### Filtering Comments by Type

Four filter buttons at the top: **All**, **Marketing**, **Sales**, **Financial**. Each shows a count. Click to filter; click All to return.

---

### How to Add a Comment

1. Select a type from the dropdown (Marketing, Sales, or Financial)
2. Type your comment in the text area
3. Press **Enter** to submit, or **Shift + Enter** for a new line

---

### What Each Comment Shows

User avatar and name, type badge (color-coded), date and time posted, comment text, and a **Delete** button (trash icon).

---

## Unit Detail Page

The Unit Detail Page gives you a full picture of a single unit — status, financials, active lease, linked leads, documents, and internal notes.

---

### Unit Header

- **Unit Number** (large heading)
- **Building name** and **Project name** as subtitle
- **Type badge** — unit type
- **Status badge** — current status
- **Time on Market bar** — appears when status is Available and an available-since date is recorded
- **Prime Owned chip** — green label when the unit is Prime Developer owned

---

### Editing a Unit

Users with **unit:edit** permission see an **Edit** button in the header. The modal allows updating: Unit Number, Unit Type, Status, Size, Asking Price, Asking Rent, Notes, and the Prime Owned toggle.

---

### Key Metrics Strip

**For units not yet sold:**
- Size (sq ft), Asking Price, Price per Square Foot, Asking Rent per month

**For units that are SOLD:**
- Size (sq ft), Sale Price (in green), Price per Square Foot, Closing Date

---

### Sold Unit Panel

When a unit is Sold and a closed sale exists, a panel shows: buyer's name, final sale price, and closing date. Not shown for active units.

---

### Active Lease Section

Hidden for Sold units. For all others shows: Tenant Name, Monthly Rent, Lease Start and End, and Lease Status. An empty state shows an **+ Add Lease** button for users with lease:edit permission.

---

### Linked Loans

Loans attached to this unit are listed here: Lender name, Loan Type, Monthly Payment, and Principal amount.

---

### Notes

Internal notes appear here. Users with unit:edit permission can edit inline — click the pencil icon, type in the text area, click **Save**.

---

### Leads and Activity Panel

Two tabs:

#### Leads Tab
Shows all leads associated with this unit: name, contact details, status chip, source badge, budget, activity count, and last updated timestamp. Users with lead:create permission see an **Add Lead** button.

#### Activity Tab
A merged timeline of all activity logged across every lead connected to this unit. Each entry shows: activity type, note, which lead it belongs to, who logged it, and when.

---

### Waitlist Panel

If any leads have been added to a waitlist for this unit, they appear here ranked by position showing: rank number, lead avatar and name, budget, and current lead status. Hidden when no waitlisted leads exist.

---

### Interior / Fit-Out Panel

Only visible to users with the **interior:view** permission. When visible, shows the fit-out project for this unit — including phases of interior work, fit-out budget, and snagging (punch list) items.

---

### Documents Panel

All documents attached to this unit are listed here. Categories: LOI, Booking Agreement, Deed, Receipt, NOC, Possession Certificate, Lease Docs, Brochure, Financial, General, Other.

Each document row shows: file name, category badge, version number (v2+ when updated), uploader name and date, and file size. Actions: **Open** and **Delete** (requires document:upload permission).

**To upload:** Click the upload button, select a file (PDF, Word, Excel, or images), enter a display name and category, click **Upload**.

---

### Comments Section

The comments thread lets the team log internal notes by type. Comment types: **Marketing** (purple), **Sales** (blue), **Financial** (green). Comments appear in this order: Marketing, then Sales, then Financial. Within each group, most recent at the top.

**To post:** Select a comment type, type your message, click Send or press Enter. Shift+Enter adds a new line without sending.

---

## Inventory

The Inventory page gives you a single, unified view of every unit across all your projects — no need to open each project separately.

---

### Status Heat Map

Seven colored tiles at the top show unit counts by status across the entire portfolio:

| Status | Meaning |
|---|---|
| **Available** | Ready to lease or sell |
| **Under Contract** | Sale agreement in progress |
| **Leased** | Active lease in place |
| **Lease Pending** | Lease being finalized |
| **Occupied** | Occupied without a formal lease record |
| **Sold** | Unit has been sold |
| **Under Construction** | Still being built |

Click any tile to filter the table to that status. Click again to clear.

---

### Summary Cards

- **Total Units** — total count across all projects
- **Available** — units currently available
- **Occupied / Leased** — combined count
- **Sold** — units that have been sold

---

### Filtering the Inventory Table

- **Search** — unit number, building name, or project name
- **Status** — seven options matching the heat map
- **Type** — Retail, Medical, Flex, Residential Lot, Office, Restaurant, Event Center
- **Project** — narrow to one project

**Clear Filters** button appears when any filter is active.

---

### Reading the Inventory Table

| Column | Description |
|---|---|
| **Unit** | Unit number or identifier |
| **Project** | Project name — click to go to the project detail page |
| **Building** | Building the unit is in |
| **Type** | Unit type |
| **Sqft** | Square footage |
| **Asking Rent** | Monthly rent being asked |
| **Asking Price** | Sale price being asked |
| **Status** | Current status badge; Available units may show a time-on-market bar |
| **Tenant / Buyer** | Current tenant or buyer name and relevant dates |
| **Actions** | Link icon to open the unit detail page |

---

### Updating a Unit's Status Quickly

If you have **unit:edit** permission, a pencil icon appears next to each status badge. Clicking it opens a quick-edit panel to change the unit's status. Click **Save** to apply.

---

### Pagination

The table shows 20 rows per page. A label at the bottom shows which units are visible (e.g., "1-20 of 87 units"). Use **Previous** and **Next** to navigate.

---

## Leads (Global View)

The Leads section gives your sales and marketing team a single place to view, manage, and analyze every lead across all projects. It consists of two views: the **Leads Page** (cross-project list) and the **Lead Dashboard** (pipeline metrics and analytics).

---

### Leads Page (Cross-Project List)

#### Finding Leads — Filters

**1. Search** — type any part of a lead's name, email, or phone number.

**2. Assignee** — filter to: Assigned to me, Unassigned, or a specific team member.

**3. Pipeline Status Strip** — a horizontal row of clickable status pills each showing a status name, colored dot, and live count. Click any pill to filter; click again to clear.

---

### Lead Statuses

| Status | Meaning |
|---|---|
| **New** | Just entered — not yet contacted |
| **Contacted** | Initial outreach made |
| **Potential** | Showing early interest |
| **Qualified** | Budget and intent confirmed |
| **Site Visit** | Has visited or scheduled a visit |
| **Proposal Sent** | Formal proposal or LOI delivered |
| **Negotiating** | Active deal discussion underway |
| **Converted** | Lead has become a sale |
| **Lost** | Chose not to proceed |
| **Dead** | No longer active — unresponsive or disqualified |

---

### Reading a Lead Card

**Top line:** Lead name, Status badge, Unit badge (sky blue if linked to a unit), Building badge (purple if linked to a building), Campaign badge (amber if from a campaign), Stale badge (amber at 14-29 days no activity; red at 30+ days).

**Second line:** Lead source, Email and phone, Project, Budget, Activity count (if any), Assigned team member.

---

### Stale Lead Tracking

A **stale lead** is any active lead with no activity logged in 14 or more days. The page header shows a total count of stale leads.

---

### Opening a Lead's Detail Panel

Click any lead card to open a detail panel showing: contact info, source, budget, unit interest, assigned team member, notes, a **Convert to Sale** button, **Units of Interest** (with add/remove), and **Activity Timeline**.

---

### Activity Types

Call, Email, Meeting, Site Visit, Follow-Up, Note, Status Change.

---

### Adding or Editing a Lead

Click **Add Lead** or the edit icon. Required fields: Project, Name, Phone, Source.

Optional: Email, Budget, Status, Building, Unit (selecting a unit clears the building field — they are mutually exclusive), Campaign, Assigned To, Notes on interest, Notes.

**Lead Sources:** Website, Referral, Social Media, Walk-In, Signage, Cold Call, Email Campaign, Broker, LoopNet, Crexi, Other.

---

### Converting a Lead to a Sale

Click **Convert to Sale** in the detail panel. Fill in: Unit, Buyer Name, Sale Price, Contract Date, Expected Close Date. Submitting creates a new sale record and marks the lead as **Converted**.

---

### Lead Dashboard

Navigate to the **Lead Dashboard** from the Leads section in the sidebar.

#### Project Filter
A dropdown at the top switches between **All Projects** or a specific project. All metrics update based on this selection.

#### KPI Tiles
- **Total Leads** — total count in portfolio or selected project
- **Conversion Rate** — percentage converted to sales
- **Active Leads** — leads not yet Converted, Lost, or Dead
- **Stale Leads (14d+)** — leads with no activity in 14+ days

#### Pipeline Funnel
A horizontal bar chart showing lead counts at each stage from New through Dead.

#### Attribution Health
A donut chart breaking down how well leads are connected to specific assets:
- Linked to a Unit
- Linked to a Building
- Linked to a Campaign
- Unattached

#### Source Breakdown
A ranked list of the top sources driving leads, each showing source name, lead count, and a share progress bar.

#### Stale Leads List
A list of all leads with no activity in 14+ days, showing lead name, current status, project, and exact days since last activity (in red). Each row links to the Leads page.

#### Recent Activity Feed
A running log of the most recent activities logged across all leads, showing activity type, note, which lead it belongs to, who logged it, and when.

---

### Leads Page vs. Leads Tab Inside a Project

| | Global Leads Page (/leads) | Leads Tab inside a Project |
|---|---|---|
| **Scope** | All leads across every project | Only leads for that one project |
| **Best for** | Daily follow-up, cross-project reporting | Managing leads within a specific project |
| **Lead Dashboard** | Separate page, filterable by project | Not available from within the project tab |

Both views show the same lead data — the difference is scope only.

---

## Campaigns & Marketing

The Campaigns & Marketing section lets marketing and sales teams plan campaigns, track spending, and measure how well each campaign generates and converts leads.

---

### Who Can Use This Section

- **Viewing campaigns:** Anyone with the Campaign Viewer role or higher
- **Creating new campaigns:** Requires the **campaign:create** permission
- **Recording spend:** Requires the **campaign:spend** permission

---

### Viewing Campaigns

A scope selector at the top switches between **All projects (portfolio)** and a single project.

Four summary tiles: **Active campaign count**, **Total spend** (in INR), **Leads / Conversions ratio**, and **Overall ROI**.

#### Campaign Table Columns

| Column | What it means |
|---|---|
| **Campaign Name** | The campaign name |
| **Channel** | Advertising channel — color-coded chip |
| **Status** | Planned, Active, Paused, or Completed |
| **Spend** | Total amount spent in INR |
| **Leads** | Number of leads attributed to this campaign |
| **Converted** | Number of those leads that became sales |
| **CPL** | Cost Per Lead (spend divided by leads) |
| **CPA** | Cost Per Acquisition (spend divided by converted leads) |
| **ROI** | Return on Investment — green at 1x or above, red below 1x |

---

### Creating a New Campaign

Click **New Campaign**. Fill in:
- **Name** (required)
- **Channel** (required) — see Channel Types below
- **Project** (optional) — leave blank for a portfolio-wide campaign
- **Planned Budget**
- **Status** — Planned, Active, Paused, or Completed
- **Start Date / End Date**
- **External ID** — if the campaign has an ID in Meta Ads Manager or Google Campaign Manager
- **Notes**

---

### Recording Campaign Spend

Click **+ Spend** on the campaign row. Fill in:
- **Amount** (required) in INR
- **Date** (required)
- **Source** — Manual, Agency Report, Meta API, or Google API
- **External Ref** — invoice number or reference

All derived metrics (CPL, CPA, ROI) recalculate automatically after saving.

---

### Channel Types

| Channel | What it represents |
|---|---|
| **Meta** | Facebook and Instagram paid advertising (blue) |
| **Google Ads** | Google Search, Display, and YouTube campaigns (green) |
| **Newspaper** | Print advertising |
| **Broker** | Broker partnerships and referral programs |
| **Email** | Email marketing campaigns |
| **Signage** | Physical signage — hoardings, site boards, outdoor banners |
| **Event** | Property expos, buyer evenings |
| **Other** | Any channel not listed above |

---

### Channel Spend Trend (6-Month View)

Below the campaign table, a spend trend chart shows monthly spending by channel over the last six months. Each channel appears as its own line using the same color as the channel chips.

---

### Currency and Number Formatting

All money figures are shown in **Indian Rupees (INR)**. Amounts of 1,00,000 or more appear in **lakh notation** (e.g., 3.5L means 3,50,000).

---

## Investors

The Investors module tracks every investor relationship — from initial equity commitment through capital calls to distributions paid out.

**Who can use this:** Users with the **investor:view** permission (typically Founders, Executives, and Finance roles).

---

### The Investors List

Four summary cards at the top: **Total Investors**, **Total Committed**, **Total Called**, and **Distributions**.

The investor table shows one row per investor: Name, Entity, # Projects, Committed, Called, and Distributions. Click any row to open that investor's full detail page.

#### Adding a New Investor

Click **Add Investor**. Fill in: Name (required), Entity / LLC Name (optional), Email (optional), Phone (optional).

---

### Investor Detail Page

The page header shows name, entity, email, and phone. Four summary cards: **Total Committed**, **Total Called**, **Pending Calls**, and **Distributions**.

The page has three tabs: **Overview**, **Capital Calls**, and **Distributions**.

---

### Overview Tab — Equity Positions

The Equity Positions table shows: Project, Ownership %, Committed, and Called.

A **pie chart** below shows capital allocation by project.

**To add a new equity position:** Click **Add Position**. Select Project, enter Ownership % and Committed Amount.

---

### Capital Calls Tab

A **capital call** is a formal request for an investor to contribute a portion of their committed capital.

**Capital Calls table columns:** Project, Amount, Due Date, Paid Date, Status (Pending / Paid / Overdue), and Action (Mark Paid button for Pending calls).

**To create a new capital call:** Click **New Capital Call**. Fill in: Project, Amount, Due Date, and Notes (optional).

---

### Distributions Tab

Records all payments made from a project back to the investor.

A **bar chart** at the top shows distributions grouped by year.

**Distributions table columns:** Project, Amount, Date, Type, and Notes.

**Distribution types:**
- **Return of Capital** — returning original investment principal
- **Preferred Return** — priority return agreed upon in investment terms
- **Profit Share** — share of project profits above the preferred return threshold

**To record a distribution:** Click **Record Distribution**. Fill in: Project, Amount, Distribution Date, Type, and Notes (optional).

---

## Tasks (Global View)

The Tasks page gives your entire team a single place to see and manage work items across every project at once.

---

### The Task List

Each task row shows: **Status** (color-coded label), **Title and Location** (Done tasks show strikethrough), **Priority** (color-coded dot), **Due Date** (turns red and shows "Overdue" if past due), **Assigned To** (profile avatar), and **Comments and Attachments** counts.

---

### Task Statuses

| Status | Color | Meaning |
|---|---|---|
| **TODO** | Gray | Work has not started |
| **IN_PROGRESS** | Blue | Actively being worked on |
| **DONE** | Green | Completed |
| **CANCELLED** | Red | No longer needed |

---

### Task Priorities

| Priority | Color | Meaning |
|---|---|---|
| **LOW** | Green | Can wait |
| **MEDIUM** | Yellow | Standard priority (default) |
| **HIGH** | Red | Needs attention soon |
| **URGENT** | Red | Requires immediate action |

---

### Filtering the List

Filter bar: **Search** (by title), **Project**, **Status**, **Priority**, **Assignee**. A **Clear** button resets all filters.

---

### Creating a New Task

Click **New Task**. Fill in:
- **Title** (required)
- **Description / Notes** (optional)
- **Project** (required) — changing this resets Building and Unit fields
- **Building** (optional, after selecting project)
- **Unit** (optional, filtered to selected building)
- **Assign To** — defaults to you
- **Priority** — defaults to MEDIUM
- **Status** — defaults to TODO
- **Due Date** (optional)

---

### Viewing and Editing a Task

Click any row to open the **task detail panel**. The panel shows:
- Title and **status toggle buttons** — click any status pill to update immediately
- Priority, Due Date, Assigned To, Created By, Project, Building, and Unit
- **Attachments** section — download existing files or attach new ones
- **Comments thread** with author name, avatar, and timestamp
- **Comment input box** at the bottom — press Send or Cmd+Enter (Mac) / Ctrl+Enter (Windows)

**Editing task details:** Task creator and Super Admin, Founder, Executive, or Project Manager roles see **Edit** and **Delete** buttons in the panel header.

---

## Reports

The Reports section gives your team centralized views of financial performance, sales activity, leasing health, debt obligations, unit inventory, and vacancy. Most reports support printing or downloading as a PDF via the **Download PDF** button.

---

### Standard Reports Page

The main Reports page contains four role-filtered tabs: Portfolio, Sales, Revenue, and Debt.

---

### Portfolio Report

**Who can use it:** Super Admin, Founder, Executive, Finance, Accounting, Project Manager

**Key numbers:** Total Investment, Total Revenue, Overall ROI (green = positive, red = negative), Closed Sales.

**Charts:** A bar chart comparing Budget vs. Actuals for each project.

**Table — Project Comparison:** Project, Phase, Budget, Actuals, Variance (green if under, red if over), Sold Units, Leased Units, Available Units, Occupancy %.

---

### Sales Report

**Who can use it:** Super Admin, Founder, Executive, Sales, Marketing

**Key numbers:** Total Pipeline, Closed Value, Conversion Rate, Avg Days to Close.

**Charts:** A Deals by Stage chart and a Sales by Project horizontal bar chart.

**Table — Available Units:** Unit Number, Project, Building, Type, Square Footage, Asking Price, Asking Rent.

---

### Revenue Report

**Who can use it:** Super Admin, Founder, Executive, Finance, Sales

**Key numbers:** Monthly Rent, Annual Rent, Active Leases, Occupancy %.

**Charts:** A Revenue by Project stacked bar chart.

**Table — Upcoming Lease Expirations:** Tenant, Unit, Project, Monthly Rent, Expiry Date, Days Left, and Urgency badge.

---

### Debt Report

**Who can use it:** Super Admin, Founder, Executive, Finance

**Key numbers:** Total Principal, Total Balance, Weighted Avg Interest Rate, Monthly Payments.

**Charts:** A Debt by Loan Type grouped bar chart (Principal vs. Balance).

**Tables:** All Loans table and Upcoming Maturities table (red highlighting when 90 days or fewer remain).

---

### Founder Reports Page

**Access:** Super Admin, Founder, Executive, Finance, Accounting

A six-tab dashboard at `/reports/founder` built for executive and financial decision-making.

---

#### Tab 1 — Portfolio P&L
Expanded profit-and-loss view with Budget vs. Actuals bar chart and a Project P&L table.

#### Tab 2 — Debt & Financing
Detailed view of all loan obligations: Total Principal, Total Balance, Weighted Average Interest Rate, Total Monthly Payments, Debt by Loan Type chart, All Loans table, and Upcoming Maturities table.

#### Tab 3 — Construction Cost
Budget discipline view: Total Investment, Total Actuals, Variance (color-coded), and Number of Projects.

#### Tab 4 — Revenue & Cash Flow
Leasing income and renewal risk: Total Monthly Rent, Total Annual Rent, Active Lease Count, Portfolio Occupancy %, Revenue by Project chart, and Upcoming Lease Expirations table.

#### Tab 5 — Unit Sales Value

**Key numbers:**
- **Total Portfolio Value** — combined asking value of all units
- **Sold** — total value and count of completed sales
- **Under Contract** — value and count of units currently under contract
- **Available/Unsold** — remaining inventory value and count

**Visuals:** A stacked bar chart by project and a hierarchical table grouped by Project then Building showing Units, Total Value, Sold, Available, Under Contract, and % Sold (green at 80%+, blue at 50%+, gray otherwise). A Portfolio Total row at the bottom.

#### Tab 6 — Cash Flow

Shows monthly cash inflows and outflows for a selected project. Select a project first — the tab requires a project to be selected before data loads.

**Key numbers (per selected project):** Total Inflows, Total Outflows, Net Cash Flow (green if positive, red if negative), Avg Monthly Burn Rate.

**Visuals:** A monthly area chart with green inflow and red outflow lines, and a monthly detail table showing Inflows, Outflows, Net, Cumulative total, and whether each entry is Actual or Forecast.

**Adding a cash flow entry — fields:** Type (Inflow or Outflow), Category (Rental Income, Loan Payment, OPEX, CAPEX, Sale Proceeds, Equity Call, or Other), Amount, Month, Actual toggle, Notes.

---

### Vacancy Report

**Access:** Roles with the **Sales View** permission.

**What it does:** Ranks all currently available (vacant) units by how long they have been on the market. Flags units sitting too long so your team can take action.

#### Filters

- **Project filter** — one project or all
- **Minimum days filter** — All Available, 30+ days, 60+ days, 90+ days (warning threshold), 180+ days (critical threshold)

#### Key Numbers

- **Vacant Units** — total count matching filters
- **Critical (180d+)** — units available for more than 180 days (red)
- **Warning (90-180d)** — units approaching critical threshold (amber)
- **Asking Value** — combined asking price/rent of vacant units shown

#### Vacancy Table

Each row is color-coded with a severity badge:

| Badge | Color | Meaning |
|---|---|---|
| **Fresh** | Green | Available for fewer than 90 days |
| **Warning** | Amber | Available for 90-180 days |
| **Critical** | Red | Available for more than 180 days |

**Columns:** Severity, Unit, Building, Project (links to project page), Type, Sqft, Asking (price or rent), Available Since, Days (color-coded), Open Unit (link to unit detail page).

---

### Role Access Summary

| Report | Founder | Executive | Finance | Accounting | Project Manager | Sales | Marketing |
|---|---|---|---|---|---|---|---|
| Portfolio | Yes | Yes | Yes | Yes | Yes | — | — |
| Sales | Yes | Yes | — | — | — | Yes | Yes |
| Revenue | Yes | Yes | Yes | — | — | Yes | — |
| Debt | Yes | Yes | Yes | — | — | — | — |
| Founder Reports (all tabs) | Yes | Yes | Yes | Yes | — | — | — |
| Vacancy Report | Yes | Yes | — | — | — | Yes | — |

---

## Notification Settings

Controls which events alert you in Prime Tracker and how you receive those alerts.

---

### How to Access Notification Settings

Log in to Prime Tracker. Click your profile or account menu (top-right corner). Navigate to **Settings → Notifications** (path: `/settings/notifications`).

---

### Notification Channels

| Channel | Status | How It Works |
|---|---|---|
| **In-App** | Live | Alerts appear inside Prime Tracker. A red badge on the bell icon shows unread count. Click the bell to open the notification panel. |
| **Email** | Live | Alerts sent to the email address on your account. |
| **WhatsApp** | Coming Soon | Planned for an upcoming release. Toggle not yet active. |

> In-App and Email notifications are currently linked — turning one on or off affects both.

---

### The Bell Icon and Notification Panel

- The bell icon in the top-right shows a red badge with unread count.
- Clicking the bell opens the notification panel listing recent alerts.
- The panel refreshes automatically every 30 seconds.

---

### Notification Types

#### Projects

| Notification | When It Fires |
|---|---|
| **Milestone Overdue** | A project milestone has passed its due date without being marked complete |

#### Leases

| Notification | When It Fires |
|---|---|
| **Lease Expiring (30 days)** | A tenant lease is expiring within the next 30 days |
| **Lease Expiring (7 days)** | A tenant lease is expiring within the next 7 days |

#### Financial

| Notification | When It Fires |
|---|---|
| **Loan Maturing (60 days)** | A loan is maturing within the next 60 days |
| **Draw Request Approved** | A draw request has been approved internally |
| **Draw Request Funded** | A draw request has been funded by the lender |
| **Budget Variance Alert** | Actual spending has exceeded approved budget by more than 10% |

#### Comments

| Notification | When It Fires |
|---|---|
| **Financial Comment** | A new financial comment has been added to a project or unit |
| **Sales Comment** | A new sales comment has been added to a project or unit |
| **Marketing Comment** | A new marketing comment has been added to a project or unit |

#### Leads

| Notification | When It Fires |
|---|---|
| **Lead Assigned** | A lead has been assigned to you |
| **Lead Status Change** | A lead you own has changed status |

---

### How to Turn a Notification On or Off

1. Go to **Settings → Notifications**
2. Find the notification type you want to change
3. Click the toggle switch to enable or disable it

Your preference saves automatically — no save button required.

---

## Admin — User Management

The Admin area is the central hub for managing who can access Prime Tracker, what they can do, and how teams are organized. Only users with the **User Management** permission can access this area.

---

### Who Can Access the Admin Area

Access to `/admin` is restricted to users with the **user:manage** permission — typically **Super Admins**. If you do not see the Admin link in your sidebar, your account does not have this access level.

---

### The Admin Tabs at a Glance

- **Users** — View, add, edit, and manage all team members
- **Roles** — Explore what each role can do and see who holds each role
- **Integrations** — Manage connected third-party tools (QuickBooks)
- **Audit Log** — Read-only history of all system actions
- **Organizations** — Manage Prime Developers' legal entities and their memberships

---

### Users Tab

The user list shows: Name and profile photo, Email address, Role (colored label), Status (Active green or Disabled red), and Last Login date.

**Filters:** Search by name or email, or filter by role (the list shows a count of matching results).

Click any user row to open a **detail panel** on the right with full profile information and management options.

---

### Adding a New User

Prime Tracker does not use email invitations. Users are created directly by an administrator.

1. Click **Add User**
2. Fill in: Name (required), Email address (required), Role (defaults to Viewer)
3. Click **Save**

The new user can log in immediately using Google Sign-In with their work email address.

---

### Assigning or Changing a Role

1. Click on the user's row to open their detail panel
2. Use the **Role** dropdown to select the new role
3. The change takes effect immediately

**Available Roles:**

| Role | Typical Use |
|---|---|
| **Super Admin** | Full system access including user management |
| **Founder** | Executive-level access across all projects and financials |
| **Executive** | Senior leadership overview |
| **Finance** | Financial reporting, budgets, loans, and cashflow |
| **Accounting** | Actuals, commitments, and vendor payments |
| **AR/AP** | Accounts receivable and payable functions |
| **Project Manager** | Full project management access |
| **Construction** | Construction tab, milestones, draws |
| **Sales** | Sales pipeline, leads, and revenue reporting |
| **Marketing** | Campaigns, leads, and marketing commentary |
| **Legal** | Contracts, documents, and legal-related data |
| **Viewer** | Read-only access across the platform |
| **Client** | Restricted buyer-portal access (Phase 2 feature) |

**Important:** The **Super Admin** role is only visible in the role selection list when the logged-in administrator is themselves a Super Admin.

---

### Activating and Deactivating Users

1. Open the user's detail panel
2. Toggle the **Active/Inactive switch** — label shows "Access blocked" when off, "User can log in" when on

Deactivating blocks login without deleting any data.

---

### Deleting a User

Click the **trash icon** on the user's row or **Delete** in the detail panel. A confirmation dialog shows the user's name before you confirm. Deactivating is usually safer than deleting for former employees.

---

### MFA Status

The user detail panel displays a shield icon:
- **Green shield** — MFA is enabled
- **Gray shield** — MFA is not yet set up

Administrators cannot reset a user's MFA from this panel.

---

### Roles Tab

An informational reference showing what each role can and cannot do.

#### Cards View

Roles are grouped by category: Administration, Leadership, Finance, Operations, and Support.

Each role card shows: how many users hold that role, a description, and how many permissions the role includes.

Clicking a role card opens a side panel with: a full permission breakdown (grouped by category, with checkmarks and dashes) and a list of all users currently assigned to that role.

#### Permission Matrix View

A full table where rows are individual permission actions grouped by category, columns are every role, and green checkmarks show what a role can do.

---

### Organizations Tab

Prime Developers operates multiple legal entities. Each entity is managed here as a separate Organization.

#### Viewing Organizations

Organization cards show: name, entity type (LLC, LP, Corp), Active or Inactive status, number of members, and number of projects linked.

#### Organization Members

Three tiers:
- **Founders** (purple) — All users with the Founder role are automatically shown here
- **Leads** (green) — Users assigned as Leads within this organization
- **Members** (blue) — Users assigned as Employees within this organization

**To add a member:** Click **Add Member**, select a user, choose their Organization Role (Lead or Employee), and confirm.

**To remove a non-Founder member:** Click the trash icon on their row and confirm.

#### Creating or Editing an Organization

Fields: Name, Entity Type (LLC, LP, or Corp), and Description (optional).

---

### Audit Log Tab

A **read-only** record of the last 100 significant actions in the system. Filter by action type:
- **CREATE** — A record was created
- **UPDATE** — A record was changed
- **DELETE** — A record was removed
- **LOGIN / LOGOUT** — User session events
- **MFA_VERIFY** — A user completed MFA verification
- **QB_SYNC** — A QuickBooks synchronization ran
- **ROLE_CHANGE** — A user's role was changed

Each log entry shows: timestamp, which user performed the action, action type, which record type was affected, record ID, and user IP address.

---

### Integrations Tab

Manages the connection between Prime Tracker and **QuickBooks Online**.

- If connected: shows company name, date of last sync, and a **Sync Now** button to manually trigger a data sync
- If not connected: click **Connect QuickBooks** to begin authorization (redirects to QuickBooks to approve the connection)

Full QuickBooks go-live requires valid credentials configured by your system administrator.
