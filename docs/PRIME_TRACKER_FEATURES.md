# Prime Tracker — Complete Feature Reference

> **Version:** 28 July 2026 · generated from the live codebase (schema, controllers, services, pages)
> **Scope:** every module, screen, workflow, business rule, automation and permission in the platform.
>
> Related docs:
> - [`PRIME_TRACKER_USER_MANUAL.md`](PRIME_TRACKER_USER_MANUAL.md) — the end-user manual ("how do I do it")
> - [`client-discovery/`](client-discovery/) — PRD, design docs, phased delivery plan
> - [`../CLAUDE.md`](../CLAUDE.md) — developer context file

---

## Table of Contents

**Part I — Foundations**
1. [What Prime Tracker Is](#1-what-prime-tracker-is)
2. [System Architecture](#2-system-architecture)
3. [Data Hierarchy & Domain Model](#3-data-hierarchy--domain-model)
4. [Roles, Permissions & Access Control](#4-roles-permissions--access-control)
5. [Navigation Map — Every Screen](#5-navigation-map--every-screen)

**Part II — Feature Modules**
6. [Authentication, Sessions & MFA](#6-authentication-sessions--mfa)
7. [Organizations & Org Settings](#7-organizations--org-settings)
8. [Administration — Users, Roles, Options, Audit, Integrations](#8-administration)
9. [Projects](#9-projects)
10. [Project Health Score](#10-project-health-score)
11. [Buildings](#11-buildings)
12. [Units & Inventory](#12-units--inventory)
13. [Milestones](#13-milestones)
14. [Budgets & Revisions](#14-budgets--revisions)
15. [Commitments & Actuals](#15-commitments--actuals)
16. [Vendors, Contracts & Change Orders](#16-vendors-contracts--change-orders)
17. [Loans](#17-loans)
18. [Draw Requests — Full Workflow](#18-draw-requests--full-workflow)
19. [Sales Pipeline](#19-sales-pipeline)
20. [Sale Payment Schedule & Receivables](#20-sale-payment-schedule--receivables)
21. [Leases & Rent Roll](#21-leases--rent-roll)
22. [Leads & Lead Funnel](#22-leads--lead-funnel)
23. [Campaigns & Marketing Attribution](#23-campaigns--marketing-attribution)
24. [Brokers & Commissions](#24-brokers--commissions)
25. [Interior / Fit-Out Module](#25-interior--fit-out-module)
26. [Daily Construction Logs](#26-daily-construction-logs)
27. [Cash Flow Engine & Obligations](#27-cash-flow-engine--obligations)
28. [Investors, Equity & Distributions](#28-investors-equity--distributions)
29. [Document Vault](#29-document-vault)
30. [Comments](#30-comments)
31. [Tasks](#31-tasks)
32. [Notifications](#32-notifications)
33. [Exceptions — "Needs Attention" Feed](#33-exceptions--needs-attention-feed)
34. [Role Dashboards](#34-role-dashboards)
35. [Reports](#35-reports)
36. [KPI Snapshots](#36-kpi-snapshots)
37. [QuickBooks Integration](#37-quickbooks-integration)
38. [Audit Log](#38-audit-log)

**Part III — Cross-Cutting**
39. [Scheduled Jobs (Cron) Summary](#39-scheduled-jobs-cron-summary)
40. [Cross-Module Event Wiring](#40-cross-module-event-wiring)
41. [Caching, Soft-Delete & Data Integrity Rules](#41-caching-soft-delete--data-integrity-rules)
42. [Not Yet Built / Known Caveats](#42-not-yet-built--known-caveats)

---
---

# Part I — Foundations

## 1. What Prime Tracker Is

Prime Tracker is the internal operating system for **Prime Developers**, a real-estate development company. It replaces the spreadsheets, WhatsApp threads and disconnected tools that previously tracked construction projects, and puts one record of truth behind every dollar, unit, lead and milestone.

It covers the **entire asset lifecycle**:

```
Land / pre-development
   → Permitting
      → Construction (budgets · draws · milestones · daily logs · vendors)
         → Lease-up / Sales (leads · campaigns · brokers · pipeline · leases)
            → Interior fit-out (design → city approval → execution → snagging → handover)
               → Stabilised / Sold-Refi (rent roll · receivables · investor distributions)
```

**Who uses it — 13 roles:** Super Admin, Founder, Executive, Finance, Accounting, AR/AP, Project Manager, Construction, Sales, Marketing, Legal, Viewer, and (Phase 2) Client / buyer portal.

**Deployment shape:** single tenant today, but **multi-organization is live** — Prime runs a US entity and an India entity as separate `Organization` records with their own members and settings. Row-level `tenantId` multi-tenancy is scaffolded in the schema but commented out.

**Scale of the build (as of this doc):**

| | Count |
|---|---|
| API modules | 35 |
| Prisma models | 70 |
| Prisma / shared enums | 30+ |
| Database migrations | 44 |
| Web pages | 30 |
| Reusable web components | 34 |
| Permission keys | ~65 |
| Scheduled cron jobs | 7 |

---

## 2. System Architecture

### Monorepo layout

```
prime-tracker/
├── apps/
│   ├── api/            NestJS REST API  (port 3001)
│   │   ├── prisma/     schema.prisma (1,945 lines) + 44 migrations + seed
│   │   └── src/
│   │       ├── modules/       35 feature modules
│   │       ├── common/        guards · interceptors · cache · events · storage · encryption
│   │       └── prisma/        PrismaService
│   └── web/            React 18 + Vite  (port 5173)
│       └── src/{pages,components,hooks,store}
├── packages/
│   └── shared/         Enums, PERMISSIONS, ROLE_PERMISSIONS, ROLE_META, API types
├── infra/{docker,scripts}
└── docs/
```

`packages/shared` is the **single source of truth** for role→permission mapping — imported by both the API guard layer and the React UI, so a permission can never drift between server and client.

### Backend stack

| Concern | Implementation |
|---|---|
| Framework | NestJS (modular, DI, decorators) |
| ORM | Prisma v5 → PostgreSQL (`prime_tracker`) |
| Auth | JWT access (15 m) + refresh (7 d), Google Workspace OAuth |
| MFA | TOTP (speakeasy-style), secret encrypted at rest |
| Field encryption | AES-256-GCM (`EncryptionService`) — loan sensitive fields, MFA secrets |
| Object storage | S3 driver behind a `StorageDriver` interface (presigned PUT uploads, signed GET URLs) |
| Caching | In-process `CacheService` with **tag-based invalidation** (`cache.wrap(key, ttl, fn, {tags})`) |
| Events | In-process `EventBus` — domain events decouple modules |
| Scheduling | `@nestjs/schedule` cron decorators |
| Queues | BullMQ + Redis (infrastructure present) |
| API docs | Swagger — `http://localhost:3001/api/docs` |
| Logging | Structured JSON logger |
| Row-level security | Postgres RLS policies on 4 modules (migration `add_rls_4_modules`) |

### Frontend stack

| Concern | Implementation |
|---|---|
| Framework | React 18 + Vite |
| UI library | **HeroUI** (fully migrated off Chakra) |
| Styling | Tailwind CSS v4 |
| Server state | TanStack Query v5 — every hook lives in `hooks/useApi.ts` (2,417 lines) |
| Client state | Zustand + `persist` (auth store → localStorage) |
| HTTP | Axios with interceptors: attach bearer, auto-refresh on 401, logout on refresh failure |
| Routing | React Router v6 |
| Charts | Recharts |
| Icons | react-icons (Feather `Fi*`) |
| Error isolation | `<ErrorBoundary section="page">` wraps every protected route |

### Request pipeline (every API call)

```
HTTP request
  → JwtAuthGuard          decode JWT, attach { sub, role, roles, permissions, mfaVerified }
  → PermissionsGuard      require EVERY permission in @RequirePermissions(...)
  → MfaGuard              (only on @MfaRequired() routes) demand mfaVerified === true
  → ProjectAccessGuard    field roles restricted to assigned projects
  → AuditInterceptor      write an immutable AuditEvent row on mutations
  → Controller → Service → Prisma
  → EventBus.emit(...)    domain event → cross-module handlers → cache invalidation
```

### Running locally

```bash
pnpm run dev          # api + web in parallel
```

```bash
pnpm run db:migrate   # prisma migrate dev
```

```bash
pnpm run db:seed      # seed demo data
```

```bash
pnpm run db:studio    # Prisma Studio GUI
```

---

## 3. Data Hierarchy & Domain Model

### The tree

```
Organization  (Prime US / Prime India)
│  └── OrgMembership (LEAD | EMPLOYEE)   +   OrgSettings (thresholds & probabilities)
│
└── Project                              ← soft-delete, slug, approvedBudget, phase = max(building phases)
     ├── ProjectMember                   ← assignment-based visibility for field roles
     ├── Building  (type incl. LOT = raw land/acreage)   ← own phase, cover photo, sortOrder
     │    └── Unit                       ← primeOwned, availableSince, mergedIntoId, soft-delete
     │         ├── Lease        ─┐
     │         ├── Sale         ─┤  polymorphic: attach to Unit **or** Building
     │         ├── Lead         ─┤  (service enforces "exactly one of")
     │         ├── Loan         ─┘  (Loan can also attach at Project level)
     │         ├── InteriorProject
     │         └── UnitComment (MARKETING | SALES | FINANCIAL)
     │
     ├── Milestone → MilestonePhoto, dependsOn (DAG, cycle-checked), linkedDrawSchedule
     ├── BudgetLine → BudgetRevision (append-only history)
     ├── Commitment · Actual             ← both scopeable to building/unit
     ├── Contract → ChangeOrder, ContractPayment   (Vendor master)
     ├── Loan → DrawRequest → DrawApproval, DrawDocument
     │        └── DrawSchedule (planned draws)
     ├── Sale → SalePayment (installments)
     ├── Lead → LeadActivity, LeadUnitInterest
     ├── Campaign (many-to-many via CampaignProject) → CampaignSpend
     ├── CashFlowEntry (manual INFLOW/OUTFLOW)
     ├── Investor → EquityPosition · CapitalCall · Distribution
     ├── Document → DocumentVersion
     ├── Task → TaskComment · TaskAttachment
     ├── DailyLog → DailyLogPhoto
     ├── ProjectComment
     └── KpiSnapshot · RentRollSnapshot · AuditEvent
```

### Polymorphic attachment rule

**Sale, Lease, Lead, Loan, InteriorProject** may attach to a **Unit** *or* a **Building** — never both, never neither. This is enforced in the service layer with explicit `BadRequestException`s, plus a check that the chosen asset actually lives under the stated project. It exists because Prime sells some assets as whole buildings (e.g. *Leander Bldg 1*) and some as individual units, and sells raw land as `BuildingType.LOT` with no units inside at all.

### Configurable vs. hard enums

A deliberate architectural split. Values the client will want to extend without a schema migration were **converted from Prisma enums to `CustomOption` rows** (see [§8.3](#83-options--configurable-dropdowns)):

| Now configurable (CustomOption) | Still a hard enum (workflow-critical) |
|---|---|
| `project_status`, `project_phase` | `DrawStatus`, `DrawApprovalStep`, `DrawApprovalAction`, `DrawDocType` |
| `unit_status`, `unit_type` | `InteriorPhase`, `InteriorStatus`, `InteriorContractType`, `SnagStatus` |
| `sale_status`, `lease_status` | `SalePaymentStatus`, `SalePaymentTrigger` |
| `lead_status`, `milestone_status` | `CampaignStatus`, `CampaignChannel`, `CampaignSpendSource` |
| `task_status`, `task_priority` | `NotificationType`, `DocCategory`, `LeadSource`, `LeadActivityType` |
| `budget_category`, `loan_type` | `ContractStatus`, `ChangeOrderStatus`, `CapitalCallStatus`, `ClientStatus`, `BuildingType`, `CommentType`, `CashFlowType`, `BudgetChangeReason`, `LostReason`, `QBSyncStatus`, `UserRole`, `OrgRole` |

Anything that drives a **state machine, a gate, or a notification trigger** stayed a hard enum. Anything that is merely a label or a bucket became configurable.

### Full enum reference

<details>
<summary><b>Click to expand every enum value</b></summary>

```
UserRole            SUPER_ADMIN · FOUNDER · EXECUTIVE · FINANCE · ACCOUNTING · AR_AP ·
                    PROJECT_MANAGER · CONSTRUCTION · SALES · MARKETING · LEGAL · VIEWER · CLIENT
OrgRole             LEAD · EMPLOYEE
ProjectStatus       ACTIVE · ON_HOLD · COMPLETED · CANCELLED
ProjectPhase        PRE_DEVELOPMENT · PERMITTING · CONSTRUCTION · LEASE_UP · STABILIZED · SOLD_REFI
ProjectType         RESIDENTIAL · COMMERCIAL · MIXED_USE · INDUSTRIAL
BuildingType        RESIDENTIAL · COMMERCIAL · MIXED_USE · INDUSTRIAL · PARKING · AMENITY ·
                    RETAIL · OFFICE · LOT
unit_type           RETAIL · MEDICAL · FLEX · RESIDENTIAL_LOT · COMMERCIAL_LOT · OFFICE ·
                    RESTAURANT · EVENT_CENTER            (+ org-added)
unit_status         AVAILABLE · UNDER_CONTRACT · LEASED · LEASE_PENDING · SOLD · OCCUPIED ·
                    UNDER_CONSTRUCTION                   (+ org-added)
milestone_status    NOT_STARTED · IN_PROGRESS · COMPLETED · OVERDUE · BLOCKED
budget_category     LAND_ACQUISITION · SITE_WORK · HARD_COSTS · SOFT_COSTS · FINANCING ·
                    PERMITS_FEES · CONTINGENCY · MARKETING · LEGAL · OTHER   (OTHER is reserved
                    — QuickBooks sync uses it for unmapped transactions)
BudgetChangeReason  SCOPE_ADD · COST_INCREASE · REALLOCATION · ESTIMATE_REFINED · CHANGE_ORDER · OTHER
loan_type           CONSTRUCTION · PERMANENT · BRIDGE · MEZZANINE · SBA      (+ org-added)
DrawStatus          DRAFT · SUBMITTED · APPROVED · FUNDED · REJECTED · CANCELLED
DrawApprovalStep    INTERNAL_FOUNDER · INTERNAL_FINANCE · LENDER_SUBMITTED · LENDER_FUNDED
DrawApprovalAction  APPROVED · REJECTED · RETURNED_FOR_INFO
DrawDocType         LIEN_WAIVER · INSPECTION_REPORT · SWORN_STATEMENT · VENDOR_INVOICE ·
                    CHANGE_ORDER · OTHER
sale_status         PROSPECT · LOI_SIGNED · UNDER_CONTRACT · CLOSED · CANCELLED
LostReason          PRICE_TOO_HIGH · FINANCING_FELL_THROUGH · CHOSE_COMPETITOR · TIMING_OFF ·
                    NO_RESPONSE · OTHER
lease_status        DRAFT · ACTIVE · EXPIRED · TERMINATED · OWNER_OCCUPIED
LeadSource          WEBSITE · SOCIAL_MEDIA · REFERRAL · COLD_CALL · WALK_IN · SIGNAGE ·
                    EMAIL_CAMPAIGN · BROKER · LOOPNET · CREXI · OTHER
lead_status         NEW · POTENTIAL · CONTACTED · SITE_VISIT · QUALIFIED · PROPOSAL_SENT ·
                    NEGOTIATING · CONVERTED · LOST · DEAD
LeadActivityType    CALL · EMAIL · MEETING · SITE_VISIT · FOLLOW_UP · NOTE · STATUS_CHANGE
CampaignChannel     META · GOOGLE_ADS · NEWSPAPER · BROKER · EMAIL · SIGNAGE · EVENT · OTHER
CampaignStatus      PLANNED · ACTIVE · PAUSED · COMPLETED
CampaignSpendSource MANUAL · META_API · GOOGLE_API · AGENCY_REPORT
InteriorPhase       DESIGN · CLIENT_APPROVAL · CITY_APPROVAL · PROCUREMENT · EXECUTION ·
                    SNAGGING · HANDOVER
InteriorStatus      NOT_STARTED · IN_PROGRESS · ON_HOLD · COMPLETED · CANCELLED
InteriorContractType PER_SQFT · FIXED · COST_PLUS
SnagStatus          OPEN · IN_PROGRESS · RESOLVED
SalePaymentStatus   SCHEDULED · DUE · PARTIALLY_PAID · PAID · OVERDUE · WAIVED
SalePaymentTrigger  ON_SIGNING · ON_MILESTONE · FIXED_DATE · ON_HANDOVER
NotificationType    MILESTONE_OVERDUE · LEASE_EXPIRING_30 · LEASE_EXPIRING_7 · LOAN_MATURITY_60 ·
                    COMMENT_FINANCIAL · COMMENT_SALES · COMMENT_MARKETING ·
                    DRAW_REQUEST_SUBMITTED · DRAW_REQUEST_APPROVED · DRAW_REQUEST_FUNDED ·
                    BUDGET_VARIANCE · LEAD_ASSIGNED · LEAD_STATUS_CHANGED ·
                    INTERIOR_PHASE_CHANGED · INTERIOR_HANDOVER_DUE · SNAG_OVERDUE ·
                    PAYMENT_DUE_7 · PAYMENT_OVERDUE
DocCategory         GENERAL · PERMIT · CONTRACT · FINANCIAL · DRAWING · PHOTO · LEGAL ·
                    BROCHURE · LOI · DEED · BOOKING_AGREEMENT · RECEIPT · NOC ·
                    POSSESSION_CERTIFICATE · CITY_APPROVAL · HANDOVER_CERTIFICATE
ContractStatus      DRAFT · ACTIVE · COMPLETED · TERMINATED
ChangeOrderStatus   PENDING · APPROVED · REJECTED
CapitalCallStatus   PENDING · PAID · OVERDUE
ClientStatus        ONBOARDING · ACTIVE · COMPLETED · TERMINATED
CashFlowType        INFLOW · OUTFLOW
CommentType         MARKETING · SALES · FINANCIAL
task_status         TODO · IN_PROGRESS · DONE · CANCELLED
task_priority       LOW · MEDIUM · HIGH · URGENT
QBSyncStatus        PENDING · SYNCED · ERROR · UNMAPPED
AuditAction         CREATE · UPDATE · DELETE · LOGIN · LOGOUT · MFA_VERIFY · EXPORT ·
                    QB_SYNC · ROLE_CHANGE
```
</details>

---

## 4. Roles, Permissions & Access Control

### 4.1 The three layers of access control

Access is enforced in **three independent layers**. All three must pass.

| Layer | Question it answers | Where |
|---|---|---|
| **1. Permission** | *May this role perform this action at all?* | `PermissionsGuard` + `@RequirePermissions()` |
| **2. Project scope** | *May this user reach **this** project's data?* | `ProjectAccessGuard` + `ProjectAccessService` |
| **3. Field/tab visibility** | *Should this role even see this UI surface?* | `TAB_ROLES`, `<PermissionGate>`, nav `permission` keys |

### 4.2 Permission catalogue (~65 keys)

Grouped as they appear in the Role Management UI:

| Group | Permissions |
|---|---|
| **Projects** | `project:view` · `project:create` · `project:edit` · `project:delete` |
| **Buildings & Units** | `building:view` · `building:edit` · `unit:view` · `unit:edit` |
| **Financial** | `financial:view` · `financial:edit` · `financial:export` · `budget:view` · `budget:edit` · `actual:view` · `actual:edit` |
| **Loans & Draws** | `loan:view` · `loan:edit` · `draw:view` · `draw:edit` · `draw:approve` |
| **Sales & Leasing** | `sales:view` · `sales:edit` · `sales:approve-discount` · `lease:view` · `lease:edit` · `payment:log` |
| **Leads** | `lead:view` · `lead:create` · `lead:edit` · `lead:delete` · `lead:convert` |
| **Marketing** | `campaign:view` · `campaign:create` · `campaign:edit` · `campaign:spend` · `campaign:delete` |
| **Milestones** | `milestone:view` · `milestone:edit` |
| **Vendors & Contracts** | `vendor:view` · `vendor:edit` · `contract:view` · `contract:edit` · `payment:approve` |
| **Interior** | `interior:view` · `interior:edit` · `interior:approve` · `interior:finance` |
| **Daily logs** | `dailylog:view` · `dailylog:edit` |
| **Brokers** | `broker:view` · `broker:edit` |
| **Documents** | `document:view` · `document:upload` · `document:delete` |
| **Comments** | `comment:view` · `comment:edit` |
| **Tasks** | `task:view` · `task:edit` |
| **Investors** | `investor:view` · `investor:manage` |
| **Reports** | `report:portfolio` · `report:sales` · `report:revenue` · `report:debt` |
| **Admin** | `user:manage` · `role:manage` · `audit:view` · `quickbooks:manage` · `system:config` · `org:manage` · `settings:manage` |

### 4.3 Role definitions and their design intent

| Role | Category | What it can do | Deliberately blocked from |
|---|---|---|---|
| **Super Admin** | admin | Everything, including `system:config` | — |
| **Founder** | leadership | Everything **except** `system:config` | System configuration only |
| **Executive** | leadership | Read everything + approve: draws, payments, interior gates, sale discounts. Manage settings. | Editing operational records |
| **Finance** | finance | Full financial stack: budgets, actuals, loans, draws (edit + approve), investors, QuickBooks, interior finance, payment logging, receivables | Sales/lead editing, milestones, campaigns |
| **Accounting** | finance | Budgets, actuals, QuickBooks, interior invoices, payment logging, portfolio report | Loan editing, draw editing/approval, investors |
| **AR/AP** | finance | Draw preparation (`draw:edit`) + document upload, payment approval, actuals, interior finance, payment logging | Budget editing, sales, reports |
| **Project Manager** | operations | Project/building/unit/milestone/vendor/contract CRUD, draws, interior (edit + finance), daily logs, documents | **`financial:view`** — no actuals/cashflow/financial reports. Keeps `budget:view` only. |
| **Construction** | operations | Milestones, daily logs (edit), documents, vendor + draw *viewing*, interior viewing | **All financials** — no `financial:view`, no `budget:view`. Cannot see budgets, spend, or variance. |
| **Sales** | operations | Sales + leases + full lead lifecycle incl. convert, unit editing, brokers, campaign *viewing*, sales/revenue reports | Campaign spend/creation, financial data, combining units (explicitly blocked in code) |
| **Marketing** | operations | Owns campaigns end-to-end (create/edit/spend/delete), leads, brokers, leases, sales/revenue reports | Lead conversion (`lead:convert`), financial data |
| **Legal** | support | Contracts, sales, leases, loans, documents (view + upload), comments | **All financial data** — `financial:view` and `budget:view` both removed |
| **Viewer** | support | Read-only: projects, buildings, units, milestones, comments, daily logs | Everything else |
| **Client** | *(Phase 2)* | Buyer portal — own unit + `isClientVisible` documents only | Not yet wired to a UI |

Two design decisions from client discovery are encoded here and worth flagging because they surprise people:
- **Construction is fully blind to money.** No budgets, no spend, no variance. They keep `draw:view` purely for the inspection/site-photo workflow.
- **Project Managers see the budget but not the financials.** They need the budget to run the job; detailed financial data is Finance + Accounting only.

### 4.4 Multi-role users

`User.roles` is an **array** (migration `add_user_roles_array`); `User.role` remains as the primary/legacy field.

- Effective permissions = **union** of every assigned role's permission set.
- Effective project scope = a user is globally scoped if **any** one of their roles is global (`isMultiRoleProjectScoped` returns true only when *all* roles are scoped).
- JWT carries `{ sub, email, role, roles[], permissions[], mfaEnabled, mfaVerified }`.

### 4.5 Project-scoped visibility

```ts
PROJECT_SCOPED_ROLES = [PROJECT_MANAGER, CONSTRUCTION, SALES, MARKETING]
```

These four **field roles** only see projects they are explicitly added to as a `ProjectMember`. Everyone else — leadership, finance, legal, viewer, super admin — sees the whole portfolio. (Decision recorded 2026-06-07.)

`ProjectAccessService` implements a resolver map that walks *any* entity id back to its owning project — `building`, `unit`, `milestone`, `sale`, `lead`, `lease`, `loan`, `draw`, `drawDocument`, `commitment`, `actual`, `budgetLine`, `budgetRevision`, `cashflow` and more — so scoping works on deep routes, not just `/projects/:id`. Cross-project list services call `listProjectScope(viewer)` and filter with the returned id set.

### 4.6 MFA step-up

`MfaGuard` reads `@MfaRequired()` and rejects any request whose JWT lacks `mfaVerified: true`, with a 403 that the frontend turns into the **MFA step-up modal**. MFA secrets are stored AES-256-GCM encrypted.

---

## 5. Navigation Map — Every Screen

### 5.1 Sidebar (role/permission filtered)

| Item | Path | Gate |
|---|---|---|
| Dashboard | `/dashboard/{founder\|construction\|sales\|finance}` | routed by role |
| Projects | `/projects` | — |
| Inventory | `/inventory` | — |
| Interior | `/interior` | `interior:view` |
| Cash Flow | `/cashflow` | `financial:view` |
| Receivables | `/receivables` | `interior:finance` |
| Tasks | `/tasks` | — |
| Leads | `/leads` | `lead:view` |
| Ads & Campaigns | `/campaigns` | `campaign:view` |
| Investors | `/investors` | `investor:view` |
| Brokers | `/brokers` | `broker:view` |
| Reports | `/reports/{founder\|construction\|sales}` | role list |
| Admin | `/admin` | `user:manage` |

The sidebar collapses to logomark-only (`/logomark-blue.png` collapsed, `/logo-full-blue.png` expanded). The top bar holds the notification bell (30 s poll, unread badge), user dropdown, and the MFA banner for Finance/Founder roles.

### 5.2 Root redirect by role

```
SUPER_ADMIN · FOUNDER · EXECUTIVE      → /dashboard/founder
CONSTRUCTION · PROJECT_MANAGER          → /dashboard/construction
SALES · MARKETING                       → /dashboard/sales
FINANCE · ACCOUNTING · AR_AP            → /dashboard/finance
LEGAL                                   → /projects
anything else                           → generic DashboardPage
```

### 5.3 Complete route table

| Route | Page | Gate |
|---|---|---|
| `/login` | LoginPage | public |
| `/auth/callback` | AuthCallbackPage | public |
| `/` | RootRedirect → role dashboard | auth |
| `/dashboard/founder` | FounderDashboardPage | auth |
| `/dashboard/construction` | ConstructionDashboardPage | auth |
| `/dashboard/sales` | SalesDashboardPage | auth |
| `/dashboard/finance` | FinanceDashboardPage | auth |
| `/projects` | ProjectsPage | auth |
| `/projects/:id/:tab?` | ProjectDetailPage (13 tabs) | auth |
| `/projects/:id/units/:unitId` | UnitDetailPage | auth |
| `/projects/:id/buildings/:buildingId` | BuildingDetailPage | `building:view` |
| `/inventory` | InventoryPage | auth |
| `/interior` | InteriorPortfolioPage | `interior:view` |
| `/interior/:id` | InteriorProjectDetailPage | `interior:view` |
| `/cashflow` | CashflowPage | `financial:view` |
| `/receivables` | ReceivablesPage | `interior:finance` |
| `/leads` | LeadsPage | auth |
| `/leads/dashboard` | → redirects to `/leads` | — |
| `/campaigns` | CampaignsPage | `campaign:view` |
| `/brokers` | BrokersPage | `broker:view` |
| `/investors` · `/investors/:id` | Investors pages | `investor:view` |
| `/tasks` | TasksPage | auth |
| `/reports` | ReportsPage (4 tabs) | auth |
| `/reports/founder` · `/construction` · `/sales` | Role report pages | auth |
| `/reports/vacancy` | VacancyReportPage | `sales:view` |
| `/settings/notifications` | SettingsPage | auth |
| `/admin/*` | AdminPage (5 tabs) | `user:manage` |

### 5.4 Project Detail — 13 tabs

`TAB_MAP = [overview, construction, budget, revenue, units, milestones, leads, draws, vendors, documents, tasks, comments, activity]`

| Tab | Contains | Visible to |
|---|---|---|
| **Overview** | Identity header, health ring, phase progress, KPIs, exceptions, team members, quick links | all roles |
| **Construction** | `BuildingsTab` — building CRUD, cover photos, drag-to-reorder, per-building budget report | Admin, Founder, Exec, Finance, Accounting, AR/AP, PM, Construction |
| **Budget** | `BudgetTab` — budget lines, revisions, variance bars, cash-obligations panel | Admin, Founder, Exec, Finance, Accounting, AR/AP, PM |
| **Revenue** | `SalesTab` + `LeasesTab` — pipeline, forecast, rent roll | Admin, Founder, Exec, Finance, Sales |
| **Units** | Units grouped by building, status chips, per-unit comment modal, combine-units | all roles |
| **Milestones** | Timeline, dependencies, photos, overdue flags | Admin, Founder, Exec, Finance, PM, Construction, Viewer |
| **Leads** | Project leads + activity timeline + unit interests | Admin, Founder, Exec, Sales, Marketing |
| **Draws** | Draw requests, approval stepper, document checklist, draw schedule | Admin, Founder, Exec, Finance, Accounting, AR/AP, PM, Construction |
| **Vendors** | Contracts, change orders, contract payments, vendor master | + Legal |
| **Documents** | Versioned document vault with category filters | most roles (not AR/AP, Viewer) |
| **Tasks** | Project tasks + comments + attachments | all roles |
| **Comments** | Project comments with MARKETING/SALES/FINANCIAL filter chips | all roles |
| **Activity** | Full audit/activity log for the project | **Admin + Founder only** |

The page resolves the requested tab against the role-filtered list; if a user deep-links to a tab they can't see, it silently falls back to their first visible tab.

---
---

# Part II — Feature Modules

## 6. Authentication, Sessions & MFA

### 6.1 Google Workspace SSO

The only interactive sign-in path. `GET /api/auth/google` → Google consent → `GET /api/auth/google/callback`.

- Domain-restricted via `GOOGLE_ALLOWED_DOMAIN` (`primedevelopers.com`). Personal Gmail is rejected.
- The user must already exist in Prime Tracker (created by an Admin) and be active.
- On success the API issues a JWT pair and redirects to the frontend callback page, which hydrates the Zustand auth store.

`POST /api/auth/login` exists for password-based/service accounts.

### 6.2 Token lifecycle

| Token | TTL | Storage |
|---|---|---|
| Access | 15 min | Zustand (persisted to localStorage) |
| Refresh | 7 days | `RefreshToken` table + client store |

The Axios interceptor attaches the bearer to every request; on a 401 it calls `POST /api/auth/refresh`, retries the original request transparently, and on refresh failure logs out and redirects to `/login`. `POST /api/auth/logout` revokes the refresh token server-side.

JWT payload: `{ sub, email, role, roles[], permissions[], mfaEnabled, mfaVerified }` — permissions are baked into the token at issue time from `ROLE_PERMISSIONS`, so the guard never hits the database.

### 6.3 TOTP multi-factor authentication

| Endpoint | Purpose |
|---|---|
| `POST /api/auth/mfa/setup` | Generate secret + `otpauth://` QR URL; secret stored **AES-256-GCM encrypted** |
| `POST /api/auth/mfa/enable` | Verify first code, flip `mfaEnabled = true` |
| `POST /api/auth/mfa/verify` | Verify a code and **re-issue tokens with `mfaVerified: true`** |

Frontend: `MfaSetupModal` runs a 4-step flow (intro → QR → verify → done), launched from the user dropdown or from `MfaBanner`, which nags Finance and Founder roles until enrolled. `MfaStepUpModal` appears when a protected action returns the MFA 403.

`GET /api/auth/me` returns the current user with resolved permissions — used to rehydrate on refresh.

---

## 7. Organizations & Org Settings

### 7.1 Multi-entity support

Prime runs a **US entity** and an **India entity**. Each is an `Organization` with its own members and settings; projects belong to an org.

| Endpoint | Action |
|---|---|
| `POST /api/organizations` | Create org |
| `GET /api/organizations` · `GET /:id` | List / read |
| `PUT /api/organizations/:id` | Update |
| `PATCH /api/organizations/:id/deactivate` | Deactivate (never hard-delete) |
| `POST /api/organizations/:id/members` | Add member with `OrgRole` (LEAD \| EMPLOYEE) |
| `DELETE /api/organizations/:id/members/:userId` | Remove member |

All gated on `org:manage`.

### 7.2 OrgSettings — the tuning knobs

Every business threshold in the platform is an `OrgSettings` column, not a hard-coded constant:

| Setting | Default | Drives |
|---|---|---|
| `saleStageProbabilities` (JSON) | `{PROSPECT:0.10, LOI_SIGNED:0.35, UNDER_CONTRACT:0.75, CLOSED:1.0, CANCELLED:0.0}` | Weighted sales forecast |
| `unitStaleDaysThreshold` | 90 | Stale-inventory alerts, health-score penalty, vacancy report |
| `budgetVarianceAlertPct` | 10 % | Budget variance cron + notifications |
| `saleStageAgeAlertDays` | 30 | "Deal stuck in stage" flag |
| `saleActivityDroughtDays` | 14 | Sales-stale cron |
| `drawFundingExpectedDays` | 14 | Default expected-funding window on a draw |
| `discountApprovalThresholdPct` | 5 % | Founder sign-off gate on discounted sales |

---

## 8. Administration

`/admin` — five tabs, gated on `user:manage`.

### 8.1 Users

| Endpoint | Action |
|---|---|
| `GET /api/users` | List all users |
| `POST /api/users` | Create user (name, email, password, role) |
| `GET /api/users/:id` | Read |
| `PUT /api/users/:id` | Update profile |
| `PATCH /api/users/:id/role` | Change primary role |
| `PATCH /api/users/:id/roles` | Set the **role array** (multi-role) |
| `PATCH /api/users/:id/status` | Activate / deactivate |
| `DELETE /api/users/:id` | Remove |
| `PATCH /api/users/me` | Self-service profile update (no admin permission needed) |

### 8.2 Roles

| Endpoint | Returns |
|---|---|
| `GET /api/users/roles` | Every role with its resolved permission list |
| `GET /api/users/roles/definitions` | `ROLE_META` (label, description, category) + `PERMISSION_CATEGORIES` |

The Roles tab renders a read-only permission matrix grouped by the 13 permission categories, using `ROLE_META` for human labels. Role→permission mapping is **code-defined** in `packages/shared` — it is documentation and enforcement in one place, not editable at runtime.

### 8.3 Options — configurable dropdowns

The `custom-options` module lets an admin extend any labelled dropdown without a migration.

| Endpoint | Action | Gate |
|---|---|---|
| `GET /api/custom-options/categories` | All category keys (system + org-added) | `project:view` |
| `GET /api/custom-options?category=` | System defaults **+** org options, sorted | `project:view` |
| `GET /api/custom-options/defaults` | Raw system-default map | `settings:manage` |
| `POST /api/custom-options` | Add an option (category, value, label, color, sortOrder) | `settings:manage` |
| `PATCH /api/custom-options/:id` | Rename / recolor / reorder / deactivate | `settings:manage` |
| `DELETE /api/custom-options/:id` | **Soft-delete** (`isActive = false`) | `settings:manage` |

**Rules:**
- System defaults are synthesised with ids like `sys_unit_status_AVAILABLE`, always returned first, `isSystem: true`, and **cannot be deleted**.
- `budget_category` → `OTHER` is load-bearing: the QuickBooks sync assigns unmapped transactions to it.
- 14 configurable categories: `project_status`, `project_phase`, `unit_status`, `unit_type`, `sale_status`, `lead_status`, `milestone_status`, `lease_status`, `task_status`, `task_priority`, `budget_category`, `loan_type` (+ any org-created category).
- Each option carries a HeroUI color token (`success`, `warning`, `danger`, `primary`, `secondary`, `default`) so new values get correct chip styling automatically.

### 8.4 Integrations

QuickBooks connection status, OAuth connect button, manual sync trigger, sync log, and project→QB class/location mappings. See [§37](#37-quickbooks-integration).

### 8.5 Audit Log

`GET /api/audit` (gate `audit:view`) — filterable immutable event stream. See [§38](#38-audit-log).

---

## 9. Projects

The central entity. `ProjectsService` is the largest service in the codebase (873 lines).

### 9.1 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/projects` | List with filters, scoped to the viewer's projects | `project:view` |
| `GET /api/projects/dashboard` | Aggregate dashboard payload incl. recent comments | `project:view` |
| `GET /api/projects/:id` | Full detail with buildings, units, counts | `project:view` |
| `GET /api/projects/slug/:slug` | Lookup by slug (clean URLs) | `project:view` |
| `GET /api/projects/:id/activity` | Activity/audit feed for the Activity tab | `project:view` |
| `POST /api/projects` | Create | `project:create` |
| `PUT /api/projects/:id` | Update | `project:edit` |
| `PUT /api/projects/:id/approved-budget` | Set the board-approved total budget | `budget:edit` |
| `DELETE /api/projects/:id` | **Soft-delete** (`deletedAt`) | `project:delete` |
| `GET/POST/DELETE /api/projects/:id/members` | Manage project team | `project:view` / `project:edit` |
| `GET /api/projects/:id/health` | Health score + breakdown | `project:view` |
| `GET /api/projects/health/bulk` | Batch health for the project list | `project:view` |

### 9.2 Key behaviours

- **Computed phase.** `Project.phase` is derived as the *maximum* phase across its buildings — a project is only in `CONSTRUCTION` if a building is, and only `STABILIZED` when all are.
- **Approved budget** is a separate field from the sum of budget lines, so the board-approved number and the working budget can be compared.
- **Soft-delete everywhere** — `deletedAt` is filtered in every query; nothing is ever physically removed.
- **Project members** drive field-role visibility ([§4.5](#45-project-scoped-visibility)). The Overview tab's `TeamMembersCard` manages this inline.

### 9.3 Projects list page

Filters by status, phase, type and search; each card shows the health ring, phase progress bar, unit counts, and financial summary (for roles with `financial:view`).

---

## 10. Project Health Score

A single 0–100 number shown as a ring on the project header and list cards. Deliberately **unit-based only** — it measures absorption, not schedule or budget, because those have their own dedicated signals.

### The formula

```
marketable      = totalUnits − unitsUnderConstruction
absorptionRate  = (sold + leased/occupied + 0.5 × pipeline) ÷ marketable
                   where pipeline = UNDER_CONTRACT + LEASE_PENDING   (half credit — not closed yet)

staleVacant     = units AVAILABLE for > 90 days
stalePenalty    = min(30, staleVacant × 5)

score           = clamp(round(absorptionRate × 100) − stalePenalty, 0, 100)
```

**Edge case:** if `marketable === 0` the score is a neutral **80**, with the reason "No units yet" or "All units under construction" — a brand-new project isn't penalised for having nothing to sell.

**Output shape:**
```json
{ "score": 72,
  "breakdown": { "units": { "score": 72, "reason": "8 sold, 3 leased, 4 vacant of 21 marketable (1 stale >90d)" } } }
```

**Performance:** cached 60 s per project under tag `projectHealth`, invalidated by unit/sale/lease domain events. Bulk scoring batches 3 projects at a time to avoid connection storms.

---

## 11. Buildings

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/buildings?projectId=` | List for a project | `building:view` |
| `GET /api/buildings/:id` | Detail with units + budget rollup | `building:view` |
| `POST /api/buildings` | Create | `building:edit` |
| `PUT /api/buildings/:id` | Update | `building:edit` |
| `PATCH /api/buildings/reorder` | **Drag-and-drop reorder** (`sortOrder`) | `building:edit` |
| `DELETE /api/buildings/:id` | Delete | `building:edit` |

### Features

- **9 building types**, including `LOT` — a raw-land parcel sold by acreage with no units inside. Sales and leases attach to a LOT building directly.
- **Per-building phase.** Each building tracks its own `ProjectPhase`; the project's phase rolls up from them.
- **Cover photos.** `BuildingCoverPhotoUploader` on the Construction tab; stored via the S3 presigned-upload path.
- **Manual ordering.** `sortOrder` + `ReorderableBuildingRow` drag handle, so buildings display in site order rather than alphabetically.
- **Per-building budget report.** `BuildingUnitBudgetReport` breaks budget/commitment/actual down by building and unit — added when budget lines gained building/unit scope.
- **Building detail page** (`/projects/:id/buildings/:buildingId`) — units, budget summary, documents, daily logs for that building.

---

## 12. Units & Inventory

### 12.1 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/units?projectId=` / `?buildingId=` | List | `unit:view` |
| `GET /api/units/:id` | Detail, incl. merge provenance | `unit:view` |
| `GET /api/units/inventory` | **Cross-project inventory** with filters | `unit:view` |
| `GET /api/units/lease-income` | Monthly lease income rollup | `unit:view` |
| `POST /api/units` | Create (building required) | `unit:edit` |
| `POST /api/units/combine` | **Merge adjacent units** | `unit:edit` |
| `PUT /api/units/:id` | Update | `unit:edit` |
| `PATCH /api/units/:id/status` | Status-only change | `unit:edit` |
| `DELETE /api/units/:id` | Soft-delete (`?force=` for hard) | `unit:edit` |

### 12.2 Units live under buildings — always

A unit cannot be created without a building. The Units tab groups units into collapsible per-building cards with a building filter dropdown.

### 12.3 Time on market

`Unit.availableSince` is stamped when a unit becomes `AVAILABLE` and cleared when it sells or leases. It powers:
- The `TimeOnMarketBar` component on unit cards
- The stale-inventory penalty in the health score
- The daily stale-units cron
- The Vacancy Report

### 12.4 Combine Units — merge, don't overlay

`POST /api/units/combine` handles the real-world case of knocking two suites together.

**Guards, in order:**
1. **Sales role is explicitly blocked** — `ForbiddenException('Sales role cannot combine units')`.
2. At least **two** source units required.
3. A **unit number for the combined unit** is required.
4. **No encumbrances** — the call fails if any source unit has an attached sale, an active lease, or an interior fit-out project.
5. The new number must be **distinct from every live unit** in the building (archived/merged-away numbers are ignored, so you can reuse them).

**What it does, in one transaction:**
- Creates a new unit with the **summed area**.
- Soft-archives each source unit and sets `mergedIntoId` → the new unit.
- Source units keep their own history — sales, leases and comments stay on the originals, so nothing is lost. The combined unit's detail page shows merge provenance ("merged from 101 + 102").

UI: `CombineUnitsModal`, with a suggested number like `101+102`.

### 12.5 Inventory page (`/inventory`)

Cross-project unit grid with:
- Stat cards: **Total Units · Available · Occupied/Leased · Sold**
- Filters: project, building, status, type, search
- Inline status update (permission-gated)
- Time-on-market indicator per row
- Click through to unit detail

### 12.6 Unit Detail page

`/projects/:id/units/:unitId` — the deepest drill-down in the app:
- Unit facts, status, area, asking price, time on market
- `SoldUnitPanel` — sale details and payment schedule if sold
- `TenantProfilePanel` — lease and tenant details if leased
- `InlineComments` — full comment thread with type selector
- Documents scoped to the unit
- Leads/activity tabs — who's interested in this unit
- Interior fit-out panel if one exists

---

## 13. Milestones

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/milestones?projectId=` | List | `milestone:view` |
| `GET /api/milestones/:id` | Detail | `milestone:view` |
| `POST` / `PUT` / `DELETE /api/milestones/:id` | CRUD | `milestone:edit` |
| `PATCH /api/milestones/:id/depends-on` | Set dependency | `milestone:edit` |
| `GET /api/milestones/:id/can-start` | Is the dependency satisfied? | `milestone:view` |
| `GET` / `POST /api/milestones/:id/photos` · `DELETE /photos/:photoId` | Progress photos | view / edit |

### Features

- **Dependency DAG.** `dependsOnId` forms a directed acyclic graph; the service **cycle-checks** before saving. `can-start` tells the UI whether a milestone is blocked.
- **Progress photos.** `MilestonePhoto` records, served through signed S3 URLs; `MilestonePhotoStrip` renders them inline on the Milestones tab.
- **Draw schedule link.** `linkedDrawScheduleId` connects a milestone to a planned draw — completing the milestone **auto-creates a DRAFT draw request** (see [§40](#40-cross-module-event-wiring)).
- **Sale payment link.** A `SalePayment` with trigger `ON_MILESTONE` is stamped DUE when its milestone completes.
- **Automatic overdue detection.** A midnight cron flips past-due milestones to `OVERDUE` and fires notifications.

---

## 14. Budgets & Revisions

### 14.1 Model

A `BudgetLine` carries `originalAmt` and `revisedAmt`. Every change writes an **append-only `BudgetRevision`** row capturing the old amount, new amount, delta, a `BudgetChangeReason`, a note, and who made it — `revisedAmt` on the line simply mirrors the latest revision.

`BudgetChangeReason`: `SCOPE_ADD` · `COST_INCREASE` · `REALLOCATION` · `ESTIMATE_REFINED` · `CHANGE_ORDER` · `OTHER` — so "we're over budget" can always be answered with *why*.

### 14.2 Building / unit scoping

Budget lines (and commitments and actuals) can be scoped to a **specific building or unit**, not just the project — added in migrations `add_budget_line_building_unit_scope` and `add_commitment_actual_building_unit_scope`. This makes the per-building and per-unit budget reports possible.

### 14.3 Summaries

`BudgetsService.summarize()` produces, for a project / building / unit scope:
- Budget, committed, actual, remaining and **variance %** per category
- Roll-up totals
- Over-threshold flags

Rendered as `VarianceBar` components (green → amber → red) plus `BudgetRevisionHistory` for the audit trail.

### 14.4 Cash obligations panel

The Budget tab embeds `ObligationsPanel` — the client's five cash-obligation buckets, viewable **Monthly / Quarterly / Annually**:

| Bucket | Source |
|---|---|
| Loan Payments | Loan monthly payment schedule |
| Sub-contractor AP | Open vendor commitments |
| TI / Interior | Interior invoices |
| Commissions | Unpaid broker commissions |
| Miscellaneous | Everything else |

This is the same data the cash-flow engine produces, re-bucketed by period. See [§27](#27-cash-flow-engine--obligations).

---

## 15. Commitments & Actuals

**Commitments** — money contractually promised but not yet spent (POs, signed vendor contracts).

| Endpoint | Gate |
|---|---|
| `GET /api/commitments?projectId=` · `GET /:id` | `financial:view` |
| `POST` / `PUT` / `DELETE /api/commitments/:id` | `financial:edit` |

**Actuals** — money actually spent.

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/actuals` | List | `financial:view` |
| `GET /api/actuals/unmapped` | **QuickBooks transactions with no project mapping** | `financial:view` |
| `POST` / `PUT /api/actuals/:id` | Create / update | `financial:edit` |

Actuals arrive from three places:
1. Manual entry
2. **QuickBooks bill/payment sync** (`qbSyncStatus`: PENDING · SYNCED · ERROR · UNMAPPED)
3. **Automatically when a draw is FUNDED** — the draw handler writes Actual rows so the funded amount lands in project spend without re-keying

Both can be scoped to building or unit, and both roll into budget variance and the cash-flow engine. `interiorProjectId` on Actual (migration `add_actual_interior_project_id`) keeps TI spend isolated from shell spend.

---

## 16. Vendors, Contracts & Change Orders

### Vendors

`GET/POST/PUT/DELETE /api/vendors` — the vendor master (`vendor:view` / `vendor:edit`), with QuickBooks vendor id mapping.

### Contracts

| Endpoint | Purpose |
|---|---|
| `GET /api/contracts?projectId=` | List |
| `GET /api/contracts/summary` | Contract value / paid / remaining rollup |
| `POST` / `PUT` / `DELETE /api/contracts/:id` | CRUD (`vendor:edit`) |
| `POST /api/contracts/:id/change-orders` | Add a change order |
| `PATCH /api/contracts/change-orders/:id/status` | Approve / reject |
| `POST /api/contracts/:id/payments` | Record a contract payment |

**Statuses:** Contract `DRAFT · ACTIVE · COMPLETED · TERMINATED`; ChangeOrder `PENDING · APPROVED · REJECTED`.

**Behaviour:** an approved change order adjusts the contract's revised value; contract payments accumulate against it, giving a live "paid vs. remaining" per vendor. Open commitment balances feed the **Sub-contractor AP** bucket in cash flow.

---

## 17. Loans

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/loans?projectId=` / `?buildingId=` | List | `loan:view` |
| `GET /api/loans/:id` | Detail | `loan:view` |
| `GET /api/loans/monthly-payments` | Monthly debt-service schedule | `loan:view` |
| `POST` / `PUT` / `DELETE /api/loans/:id` | CRUD | `loan:edit` |
| `GET /api/loans/:loanId/schedule` | Planned draw schedule | `draw:view` |
| `POST /api/loans/:loanId/schedule` · `DELETE /schedule/:id` | Manage schedule lines | `draw:edit` |

### Features

- **Three attachment levels** — project (portfolio loan), building (per-tower construction loan, e.g. Centro Plaza Bldgs 1 & 2), or unit.
- **Encrypted sensitive fields** — AES-256-GCM at rest via `EncryptionService`.
- **Configurable loan types** — `loan_type` is now a CustomOption category (Construction · Permanent · Bridge · Mezzanine · SBA + org-added).
- **Monthly payment computation** feeds the debt report, finance dashboard, and the **Loan Payments** cash-flow bucket.
- **Maturity watch** — a daily cron notifies on loans maturing within 60 days.
- **Draw schedule** — planned draws by date/amount, optionally linked to milestones. This is the *outflow* mirror of the sale payment schedule.

---

## 18. Draw Requests — Full Workflow

The most heavily governed workflow in the platform. CRUD lives in `LoansService`; **workflow actions** live in `DrawsService` against a formal state machine.

### 18.1 State machine

```
                    ┌──────────── cancel (any non-terminal) ────────────┐
                    │                                                    ▼
  DRAFT ──submit──▶ SUBMITTED ──approveInternal──▶ APPROVED ──markFunded──▶ FUNDED ✓
    ▲                   │                             │
    │              returnForInfo                    reject
    │                   │                             │
    └───────────────────┘                             ▼
                        └────── reject ──────▶     REJECTED ──revise──▶ DRAFT

  FUNDED and CANCELLED are terminal.
```

### 18.2 Document gates — enforced, not advisory

Transitions **refuse to run** without the required documents attached:

| Transition | Required documents |
|---|---|
| `DRAFT → SUBMITTED` | `SWORN_STATEMENT`, `VENDOR_INVOICE` |
| `SUBMITTED → APPROVED` | `LIEN_WAIVER`, `INSPECTION_REPORT`, `SWORN_STATEMENT`, `VENDOR_INVOICE` |

`GET /api/draws/:id/checklist` returns each required type with an uploaded count — rendered as the red/green `DocumentChecklist` on the draw detail modal, so nobody discovers a missing lien waiver at submit time.

### 18.3 Endpoints

| Endpoint | Action | Gate |
|---|---|---|
| `GET /api/draws/:id` | Detail with approvals + documents | `draw:view` |
| `GET /api/draws/:id/checklist` | Document readiness | `draw:view` |
| `POST /api/draws/:id/submit` | DRAFT → SUBMITTED | `draw:edit` |
| `POST /api/draws/:id/approve-internal` | SUBMITTED → APPROVED | `draw:approve` |
| `POST /api/draws/:id/submit-to-lender` | Record lender submission | `draw:edit` |
| `POST /api/draws/:id/return-for-info` | Bounce back to DRAFT | `draw:edit` |
| `POST /api/draws/:id/mark-funded` | APPROVED → FUNDED | `draw:approve` |
| `POST /api/draws/:id/reject` | Reject with reason | `draw:approve` |
| `POST /api/draws/:id/cancel` | Cancel | `draw:edit` |
| `POST /api/draws/:id/documents` | Attach document | `draw:edit` |
| `PATCH /api/draws/documents/:documentId` | **Rename** an attachment | `draw:edit` |
| `DELETE /api/draws/documents/:documentId` | Remove | `draw:edit` |

### 18.4 Approval audit trail

Every workflow action writes an append-only `DrawApproval` row: `{ step, action, actorId, comment, createdAt }`.

- **Steps:** `INTERNAL_FOUNDER` · `INTERNAL_FINANCE` · `LENDER_SUBMITTED` · `LENDER_FUNDED`
- **Actions:** `APPROVED` · `REJECTED` · `RETURNED_FOR_INFO`

`DrawApprovalStepper` renders this as a visual chain with actor names and timestamps.

### 18.5 What happens when a draw is FUNDED

Handled by `DrawEventHandlersService` on the `drawRequest.funded` event:
1. **Actual rows are auto-created** — the funded amount lands in project spend with no re-keying.
2. Dashboard and financial caches are invalidated.
3. Finance and leadership are notified.

This is the loop-closer: draw → money → spend, without a spreadsheet in between.

### 18.6 Funding-overdue watch

A daily 8 AM cron finds draws past their `expectedFundingDate` (default window from `OrgSettings.drawFundingExpectedDays`, or a manually entered date — added in the most recent commit) and emits `drawRequest.fundingOverdue`, which notifies Finance + Founder and surfaces the draw in the exceptions feed.

---

## 19. Sales Pipeline

### 19.1 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/sales?projectId=` | List | `sales:view` |
| `GET /api/sales/pipeline` | Grouped by status + velocity metrics | `sales:view` |
| `GET /api/sales/forecast` | Probability-weighted forecast | `sales:view` |
| `GET /api/sales/receivables` | Upcoming installments | `interior:finance` |
| `GET /api/sales/:id` | Detail | `sales:view` |
| `POST` / `PUT` / `DELETE /api/sales/:id` | CRUD | `sales:edit` |
| `POST /api/sales/:id/approve-discount` | Founder discount sign-off | `sales:approve-discount` |

### 19.2 Pipeline metrics

`getPipeline()` returns:
- **`byStatus`** — deals grouped by stage
- **`avgDaysToClose`** — mean days from creation to close across CLOSED sales (sales velocity)
- **`totalPipelineValue`** — sum of open deals
- **`closedRevenue`** — booked revenue

### 19.3 Probability-weighted forecast

```
Forecast = Σ (salePrice × stageProbability)  for all non-CLOSED, non-CANCELLED deals
```

| Stage | Default probability |
|---|---|
| PROSPECT | 10 % |
| LOI_SIGNED | 35 % |
| UNDER_CONTRACT | 75 % |
| CLOSED | 100 % (booked separately as `closedYtd`) |
| CANCELLED | 0 % |

Overridable per org via `OrgSettings.saleStageProbabilities`. The response breaks down by stage (`count`, `value`, `weighted`, `probability`) and keeps `closedYtd` separate — total pipeline overstates, closed-only understates, and the weighted number is what gets shown to lenders. Rendered as `ProbabilityChip` in the UI.

### 19.4 Discount approval gate

Prime's rule: a sale priced more than **`discountApprovalThresholdPct`** (default 5 %) below the unit's asking price needs **Founder/Co-Founder sign-off** before the deal can be committed.

- The gate fires on transition to **UNDER_CONTRACT or CLOSED** — `assertDiscountApproved()` throws otherwise.
- `POST /api/sales/:id/approve-discount` stamps `discountApprovedById` + `discountApprovedAt`.
- Single approval only (explicit client decision — no multi-step chain).

### 19.5 Closing a sale — the concurrency-safe path

Closing runs in a transaction with **optimistic locking**:

```ts
updateMany({ where: { id, status: { not: 'CLOSED' } }, data })
if (guard.count === 0) → lost the race; return current row, no side effects
```

When the guard wins:
1. **Broker commission is computed and stamped** onto `brokerCommissionAmt`.
2. The **unit flips to `SOLD`** and `availableSince` is cleared (time-on-market stops).
3. `sale.statusChanged` is emitted.

The guard exists so two simultaneous closes can't double-stamp a commission.

### 19.6 Cancelling a sale — releases the unit

The mirror problem: a cancelled sale used to leave its unit stuck in `UNDER_CONTRACT` forever. Now:
- If the unit is in a **reserved** state (`UNDER_CONTRACT` or `LEASE_PENDING`), it flips back to `AVAILABLE` and `availableSince` restarts.
- A `SOLD`/`LEASED`/`OCCUPIED` unit is **never** overridden.
- A `LostReason` is captured (`PRICE_TOO_HIGH` · `FINANCING_FELL_THROUGH` · `CHOSE_COMPETITOR` · `TIMING_OFF` · `NO_RESPONSE` · `OTHER`); the UI (`CancelSaleModal`) forces a choice, the API defaults to `OTHER` for API compatibility.

### 19.7 Activity drought detection

Every sale update bumps `lastActivityAt`. A daily cron flags deals with no activity for `saleActivityDroughtDays` (default 14) into the exceptions feed.

---

## 20. Sale Payment Schedule & Receivables

The **inflow** counterpart to the draw schedule. Installments hang off a Sale and are driven by real events, not just dates.

### 20.1 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/sales/:saleId/payments` | Installments for a sale | `sales:view` |
| `POST /api/sales/:saleId/payments` | Add an installment | `sales:edit` |
| `POST /api/sales/:saleId/payments/from-template` | Generate a whole schedule from a template | `sales:edit` |
| `PATCH /api/sales/payments/:id` | Edit | `sales:edit` |
| `POST /api/sales/payments/:id/log` | **Record a (partial) payment** | `payment:log` |
| `DELETE /api/sales/payments/:id` | Remove | `sales:edit` |
| `GET /api/sales/receivables?weeks=` | Upcoming + overdue receivables | `interior:finance` |

### 20.2 Four trigger types

| Trigger | Due date comes from |
|---|---|
| `ON_SIGNING` | Contract signature |
| `ON_MILESTONE` | **Stamped when the linked milestone completes** — `effectiveDueDate` is written and status flips SCHEDULED → DUE |
| `FIXED_DATE` | A hard calendar date |
| `ON_HANDOVER` | **Stamped when the linked interior fit-out reaches HANDOVER** (this is how the TI installment bills) |

Validation: a milestone-triggered payment requires a milestone; a fixed-date one requires a date. Amounts can be absolute (`amount`) or `percentOfPrice`.

### 20.3 Partial payments

`POST /payments/:id/log` accumulates into `paidAmount`:

```
paidAmount === 0            → SCHEDULED / DUE
0 < paidAmount < amount     → PARTIALLY_PAID
paidAmount >= amount        → PAID
past due & unpaid           → OVERDUE   (set by cron)
                            → WAIVED    (manual)
```

### 20.4 Receivables view

`receivables(weeks = 4)` returns every SCHEDULED/DUE/PARTIALLY_PAID/OVERDUE installment falling inside the horizon, sorted by effective due date, with `outstanding = amount − paidAmount` and buyer/project context.

**`/receivables` page** — stat cards for **Total Outstanding · Overdue · Due This Week · High Priority**, filterable by window / status / project. Also surfaces as `ReceivablesWidget` on the Finance dashboard, and feeds the `salePayments` inflow source in the cash-flow engine.

### 20.5 Notifications

- `PAYMENT_DUE_7` — installment due within 7 days
- `PAYMENT_OVERDUE` — past due and unpaid

---

## 21. Leases & Rent Roll

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/leases?projectId=` | List | `lease:view` |
| `GET /api/leases/rent-roll` | Rent roll snapshot | `lease:view` |
| `GET /api/leases/:id` | Detail | `lease:view` |
| `POST` / `PUT` / `DELETE /api/leases/:id` | CRUD | `lease:edit` |

### Features

- **Polymorphic** — a lease attaches to a Unit or a Building.
- **`OWNER_OCCUPIED` status** for Prime-occupied space that shouldn't count as vacancy or as rental income.
- **Escalation** — `escalationPct` + `escalationFreq`; the cash-flow engine applies escalation when projecting lease income forward.
- **Active-lease uniqueness** — migration `lease_unit_active_unique` enforces at the database level that a unit can have only one active lease.
- **Expiry watch** — daily cron notifies at **30 days** and **7 days** before expiry; expiring leases also surface in the exceptions feed.
- **Rent roll + `RentRollSnapshot`** — point-in-time snapshots for historical comparison.
- **Monthly lease income** feeds the revenue report, finance dashboard and the `leaseIncome` inflow source.
- `TenantProfilePanel` shows tenant details on the unit detail page.

---

## 22. Leads & Lead Funnel

### 22.1 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/leads` | List with filters | `lead:view` |
| `GET /api/leads/dashboard` | Funnel + source/campaign analytics | `lead:view` |
| `GET /api/leads/waitlist?unitId=` | **Demand list for a unit** | `lead:view` |
| `GET /api/leads/:id` | Detail | `lead:view` |
| `POST /api/leads` | Create | `lead:create` |
| `PUT` / `DELETE /api/leads/:id` | Update / delete | `lead:edit` / `lead:delete` |
| `GET` / `POST /api/leads/:id/activities` | Activity timeline | view / edit |
| `POST /api/leads/:id/interests` · `DELETE /interests/:interestId` | **Multi-unit interest** | `lead:edit` |
| `POST /api/leads/:id/convert` | **Convert to a Sale** | `lead:convert` |

### 22.2 The 10-stage funnel

```
NEW → POTENTIAL → CONTACTED → SITE_VISIT → QUALIFIED → PROPOSAL_SENT → NEGOTIATING → CONVERTED
                                                                                    ↘ LOST / DEAD
```

`POTENTIAL` and `SITE_VISIT` were added post-discovery (migration `add_lead_funnel_stages`) to match how Prime's sales team actually works. All ten are CustomOptions, so more can be added.

### 22.3 Multi-unit interest & the waitlist

A lead is not limited to one unit. `LeadUnitInterest` is an idempotent join (unique on lead+unit) with an optional note.

**`GET /api/leads/waitlist?unitId=`** inverts it: *every lead interested in this unit, oldest first*. That's a demand signal for pricing and a call list the moment a unit frees up.

### 22.4 Attribution

Each lead carries `source` (11 values incl. **LOOPNET** and **CREXI**, added for commercial listing portals), UTM parameters, an optional `campaignId`, and an optional `brokerId`. This is what makes campaign ROI and broker performance computable.

### 22.5 Convert to sale

`POST /api/leads/:id/convert` runs in a transaction: creates the `Sale`, links `convertedToSale`, flips the lead to `CONVERTED`, and logs a `STATUS_CHANGE` activity. Requires `lead:convert` — which **Marketing deliberately does not have**; only Sales converts.

### 22.6 Activity timeline

7 activity types: `CALL · EMAIL · MEETING · SITE_VISIT · FOLLOW_UP · NOTE · STATUS_CHANGE`. Status changes are auto-logged; the rest are manual. Rendered as a side-panel timeline on both `/leads` and the project Leads tab.

### 22.7 Notifications

`LEAD_ASSIGNED` and `LEAD_STATUS_CHANGED`.

---

## 23. Campaigns & Marketing Attribution

### 23.1 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/campaigns` | List | `campaign:view` |
| `GET /api/campaigns/performance` | **Full ROI/CPL/CPA analytics** | `campaign:view` |
| `GET /api/campaigns/spend-trend` | Spend over time | `campaign:view` |
| `GET /api/campaigns/spend-by-campaign` | Spend breakdown | `campaign:view` |
| `GET /api/campaigns/:id` | Detail | `campaign:view` |
| `POST` / `PUT` / `DELETE /api/campaigns/:id` | CRUD | `campaign:create` / `:edit` / `:delete` |
| `GET` / `POST /api/campaigns/:id/spend` | Spend ledger | `campaign:view` / `campaign:spend` |

### 23.2 Multi-project campaigns

A campaign spans **many projects** via the `CampaignProject` join table (migration `campaign_multi_project`) — one Meta campaign can promote three developments, and the analytics still attribute correctly. Scoped viewers only see campaigns touching their assigned projects.

### 23.3 Spend ledger

`CampaignSpend` rows carry amount, date, source and external reference.

**Sources:** `MANUAL` (Marketing/Founder entry) · `META_API` · `GOOGLE_API` (both reserved for future direct sync) · `AGENCY_REPORT` (bulk import from a monthly agency statement).

### 23.4 Performance analytics

For each campaign, `performance()` computes (optionally date-filtered):

| Metric | Definition |
|---|---|
| `totalSpend` | Sum of spend ledger |
| `leadCount` | Attributed leads |
| `byStatus` | Lead count per funnel stage |
| `weightedLeads` | Leads weighted by stage probability |
| `convertedCount` | Leads whose sale actually **CLOSED** |
| `convertedRevenue` | Sum of those closed sale prices |
| **`cpl`** | Cost per lead = spend ÷ leads |
| **`cpa`** | Cost per acquisition = spend ÷ conversions |
| **`roi`** | Return on ad spend = convertedRevenue ÷ spend |

All ratio metrics return `null` rather than dividing by zero. Only **CLOSED** sales count as revenue — a converted lead whose deal later fell through does not inflate ROI.

### 23.5 Campaigns page

Stat cards: **Active campaigns · Total spend · Leads/conversions · Overall ROI**. Per-campaign cards with channel chip, multi-project chips, spend-to-budget bar, lead funnel breakdown, and inline spend entry.

---

## 24. Brokers & Commissions

Brokers bring leads. They have **no login** — this is an internal tracking module.

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/brokers` | List with lead/sale counts | `broker:view` |
| `GET /api/brokers/report` | **Performance report** | `broker:view` |
| `GET /api/brokers/:id` | Detail + last 50 leads + last 50 sales | `broker:view` |
| `GET /api/brokers/:id/sales` | Attributed sales | `broker:view` |
| `POST` / `PATCH` / `DELETE /api/brokers/:id` | CRUD (soft-delete) | `broker:edit` |
| `PATCH /api/brokers/sales/:saleId/mark-commission-paid` | **Mark commission paid** | `broker:edit` |

### Commission model

- A broker has `commissionRate` (%) **or** `commissionFlat` ($).
- Commission is **earned when the attributed sale CLOSES** — `SalesService.computeBrokerCommission()` calculates it and stamps `Sale.brokerCommissionAmt` inside the same optimistic-locked transaction that flips the unit to SOLD.
- `brokerCommissionPaidAt` (migration `add_broker_commission_paid_at`) tracks settlement separately from accrual.
- **Unpaid commissions feed the Commissions bucket** in the cash-flow obligations panel.

**Brokers page** stat cards: **Brokers · Leads brought · Closed sales · Commission earned**.

---

## 25. Interior / Fit-Out Module

The largest net-new build of this cycle. A post-shell fit-out engagement for a unit or whole building, with its own **isolated TI budget**, sub-contractor invoices, snagging and handover. The client-facing per-sqft price lives on the linked Sale as a `SalePayment` installment — operational work and billing stay separate.

### 25.1 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/interior/portfolio` | Cross-project fit-out portfolio | `interior:view` |
| `GET /api/interior` · `GET /:id` | List / detail | `interior:view` |
| `POST` / `PATCH` / `DELETE /api/interior/:id` | CRUD | `interior:edit` |
| `POST /api/interior/:id/advance` | **Advance one phase** (gated) | `interior:edit` |
| `POST /api/interior/:id/approve-client` | Record client approval | `interior:approve` |
| `POST /api/interior/:id/approve-city` | Record city approval | `interior:approve` |
| `POST /api/interior/:id/scope` · `DELETE /scope/:itemId` | **BOQ / scope items** | `interior:edit` |
| `POST /api/interior/:id/invoices` | **Sub-contractor invoice** | `interior:finance` |
| `POST /api/interior/:id/snags` | Raise a snag | `interior:edit` |
| `PATCH /api/interior/snags/:snagId` · `POST /snags/:snagId/resolve` | Update / resolve | `interior:edit` |
| `GET/POST/PATCH/DELETE /api/interior/templates[/:tid]` | **Package templates** | view / edit |

### 25.2 The 7-phase lifecycle — linear, forward-only

```
DESIGN → CLIENT_APPROVAL → CITY_APPROVAL ┊ PROCUREMENT → EXECUTION → SNAGGING → HANDOVER
                                          ┊
              phases left of ┊ may overlap the tail of shell construction
              phases right of ┊ require the shell to be complete
```

`canTransition(from, to)` allows **only the immediate next phase**. No skipping, no going backward. Hold and cancellation are `InteriorStatus` changes (`ON_HOLD`, `CANCELLED`), not phase moves.

### 25.3 Three gates on `advancePhase`

Checked in order, each throwing a specific error:

**1. Linearity** — target must be exactly the next phase.
> `Cannot advance from DESIGN to EXECUTION — phases are linear and forward-only`

**2. Soft parallel gate** — `PROCUREMENT` and `EXECUTION` require the anchor building's shell to be complete, i.e. its phase is one of `LEASE_UP`, `STABILIZED`, `SOLD_REFI`. This encodes the client's rule: **no parallel interior execution before the shell is done.**

**3. Document gates** — a document of the required category must already be on file:

| Entering | Required document |
|---|---|
| `EXECUTION` | `CITY_APPROVAL` |
| `HANDOVER` | `HANDOVER_CERTIFICATE` |

> `Cannot enter EXECUTION: a CITY_APPROVAL document must be on file first`

`DocumentGateChip` shows gate status in the UI before you try.

### 25.4 Contract types

| Type | Value calculation |
|---|---|
| **`PER_SQFT`** (client default) | `ratePerSqft × area` |
| `FIXED` | Flat `contractValue` |
| `COST_PLUS` | Cost + margin |

### 25.5 Scope / BOQ

`InteriorScopeItem` rows form the bill of quantities. `InteriorPackageTemplate` + `InteriorPackageItem` (migration `interior_packages_and_handover`) let a standard fit-out package be applied to a new project in one step rather than re-entering line items. Managed via `InteriorBOQPanel` and `InteriorPackagesModal`.

### 25.6 Sub-contractor invoices

`InteriorInvoice` — vendor, amount, invoice number, invoice date, status `PENDING → APPROVED → PAID`. Requires `interior:finance` (Finance, Accounting, AR/AP, PM). Invoices roll into "spend to date", the TI-budget-used bar, and the **TI / Interior** cash-flow bucket.

### 25.7 Snagging (punch list)

`SnagItem` — description, location, assignee, due date, status `OPEN → IN_PROGRESS → RESOLVED`. `SnagPanel` shows open counts on the tab label. Overdue snags fire the `SNAG_OVERDUE` notification via a daily check.

### 25.8 Handover

Reaching `HANDOVER` requires the handover certificate document, records the signing client representative and notes, and **flips the linked `ON_HANDOVER` sale installment to DUE** — which is how the TI portion actually gets billed.

### 25.9 Screens

- **`/interior`** — portfolio. Stat cards: **Active fit-outs · Contract value · Spend to date · Handover ≤ 30d**.
- **`/interior/:id`** — detail with phase stepper, contract/spent/TI-budget-used metrics, client & city approval chips, and tabs: **Scope/BOQ · Invoices · Snags · Documents**.
- `InteriorPanel` embeds a compact view on the unit detail page.

### 25.10 Notifications

`INTERIOR_PHASE_CHANGED` · `INTERIOR_HANDOVER_DUE` · `SNAG_OVERDUE`.

---

## 26. Daily Construction Logs

The client's **#1 stated pain point**: site progress lived in WhatsApp and was lost.

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/daily-logs?projectId=` / `?buildingId=` | Feed, newest first | `dailylog:view` |
| `GET /api/daily-logs/:id` | Detail | `dailylog:view` |
| `POST` / `PATCH` / `DELETE /api/daily-logs/:id` | CRUD | `dailylog:edit` |
| `POST /api/daily-logs/:id/photos` · `DELETE /photos/:photoId` | Photos | `dailylog:edit` |

### Features

- A log is a dated entry per project (optionally per building) with narrative, author, and **multiple photos**.
- Photos are stored in S3 and served through **1-hour signed URLs** generated at read time — a failed signature degrades to an empty URL rather than breaking the feed.
- Requires **either** `projectId` or `buildingId` — an unscoped query is rejected.
- Sorted by `logDate` desc, then `createdAt` desc.
- **Who can write:** Construction, Project Manager (`dailylog:edit`). **Who can read:** everyone including Viewer.
- `DailyLogFeed` renders the timeline with photo grid.

---

## 27. Cash Flow Engine & Obligations

`CashflowEngineService` is the unified money-movement projection — it merges **every** cash source into one forward monthly timeline for a project or the whole portfolio.

### 27.1 The nine sources

| Direction | Sources |
|---|---|
| **INFLOWS** | `salePayments` · `leaseIncome` · `drawSchedule` · `manual` |
| **OUTFLOWS** | `loanPayments` · `subcontractorAP` · `interiorTI` · `commissions` · `misc` |

The five outflow categories are **exactly** the client's budget buckets, which is what makes the Budget tab's obligations view a straight re-bucketing of the same numbers.

### 27.2 Timing model

| Source shape | How it lands on the timeline |
|---|---|
| **Recurring** (lease income, loan payments) | Spread across every month in range; lease `escalationPct`/`escalationFreq` applied when configured |
| **Dated** (sale installments, planned draws) | Land on their actual date |
| **"Owed now"** (open vendor commitments, interior invoices, unpaid commissions) | Land in **month 1** as near-term cash need — this is what answers *"how much cash do I need in the next 2/4 weeks?"* |

### 27.3 Output

```ts
{
  horizonMonths, startMonth,
  summary: { totalInflows, totalOutflows, netCashFlow, burnRate, endingCumulative },
  monthly: [{ month: "2026-08", inflows, outflows, net, cumulative,
              inflowsBySource: {...}, outflowsByCategory: {...} }, ...]
}
```

Horizon defaults to 12 months, clamped to 1–60.

### 27.4 Endpoints

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/cashflow` | Manual entries | `financial:view` |
| `GET /api/cashflow/forecast` | Project timeline | `financial:view` |
| `GET /api/cashflow/portfolio` | Portfolio timeline | `financial:view` |
| `GET /api/cashflow/obligations` | Obligations by month/quarter/year | `budget:view` |
| `POST` / `PUT` / `DELETE /api/cashflow/:id` | Manual entries | `financial:edit` |

### 27.5 Screens

- **`/cashflow`** — stat cards **Projected Inflow · Projected Outflow · Net Cash Flow · Avg Monthly Burn**; stacked chart with inflow/outflow/net/cumulative series (`CashflowForecastView`).
- **`ObligationsPanel`** on the Budget tab — the five buckets × Monthly / Quarterly / Annually, with outstanding totals per bucket. Note it uses `budget:view` (not `financial:view`), so Project Managers can see cash obligations without seeing the full financial module.

---

## 28. Investors, Equity & Distributions

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/investors` | List | `investor:view` |
| `GET /api/investors/summary` | Portfolio equity summary | `investor:view` |
| `GET /api/investors/capital-calls` | All capital calls | `investor:view` |
| `GET /api/investors/:id` | Detail | `investor:view` |
| `POST` / `PUT /api/investors/:id` | CRUD | `investor:manage` |
| `POST /api/investors/:id/positions` | Add equity position | `investor:manage` |
| `POST /api/investors/capital-calls` | Issue a capital call | `investor:manage` |
| `PATCH /api/investors/capital-calls/:id/paid` | Mark paid | `investor:manage` |
| `POST /api/investors/distributions` | Record a distribution | `investor:manage` |

**Model:** `Investor` → `EquityPosition` (ownership % per project) · `CapitalCall` (`PENDING · PAID · OVERDUE`) · `Distribution` (payouts).

**Screens:** `/investors` list and `/investors/:id` detail with positions, call history and distribution history. Finance and Founder can manage; Executive can view.

---

## 29. Document Vault

| Endpoint | Purpose | Gate |
|---|---|---|
| `POST /api/documents/presigned-upload` | **Get a presigned S3 PUT URL** | `document:upload` |
| `GET /api/documents?projectId=` / `?unitId=` / `?buildingId=` / `?interiorProjectId=` | List with signed URLs | `document:view` |
| `POST /api/documents` | Register an uploaded file | `document:upload` |
| `PATCH /api/documents/:id` | **Rename** | `document:upload` |
| `POST /api/documents/:id/replace` | **Replace file → new version** | `document:upload` |
| `DELETE /api/documents/:id` | Delete | `document:upload` |
| `GET /api/documents/:id/download` | Signed download URL | `document:view` |

### Features

- **Direct-to-S3 presigned uploads.** The browser PUTs straight to S3 — the API never proxies file bytes. (A checksum-mismatch bug in this path was fixed in a recent commit.)
- **Versioning.** `DocumentVersion` keeps full history; `replaceFile` creates a version rather than overwriting.
- **Signed read URLs** generated per request, not stored.
- **`externalUrl`** supported for documents that live elsewhere (a link instead of a file).
- **Polymorphic attachment** — project, building, unit, sale, lead, or interior project.
- **16 categories** — including `LOI`, `DEED`, `BOOKING_AGREEMENT`, `RECEIPT`, `NOC`, `POSSESSION_CERTIFICATE` (buyer-portal set) and `CITY_APPROVAL`, `HANDOVER_CERTIFICATE` (interior phase gates).
- **`isClientVisible`** flag — the buyer-portal toggle for Phase 2.
- **Load-bearing for workflows** — the draw checklist and the interior phase gates both query this module. A missing document doesn't just look bad; it blocks the transition.

---

## 30. Comments

Deliberately non-standard routes — comments are polymorphic across units and projects.

```
GET    /api/comments?unitId=:id          list unit comments
GET    /api/comments?projectId=:id       list project comments
GET    /api/comments/recent?limit=20     recent across everything
POST   /api/comments                     { unitId? | projectId?, content, commentType? }
PUT    /api/comments/unit/:id            update unit comment
PUT    /api/comments/project/:id         update project comment
DELETE /api/comments/unit/:id            delete unit comment
DELETE /api/comments/project/:id         delete project comment
```

Reads gate on `unit:view`; writes on `comment:edit`.

### The three comment types

| Type | Color |
|---|---|
| `MARKETING` | purple — `bg-purple-100 text-purple-700` |
| `SALES` | blue — `bg-blue-100 text-blue-700` |
| `FINANCIAL` | green — `bg-green-100 text-green-700` |

**Sort order is always `MARKETING → SALES → FINANCIAL`, then `createdAt` desc within each group** — everywhere comments appear.

### Where they appear

1. **Dashboard** — `recentComments` from the projects dashboard, grouped by type with colored section headers
2. **Project Comments tab** — with type filter chips
3. **Units tab** — per-unit modal (`UnitCommentsPanel`)
4. **Unit detail page** — full thread (`InlineComments`)

Posting a comment fires the matching notification: `COMMENT_MARKETING` / `COMMENT_SALES` / `COMMENT_FINANCIAL`. `commentType` defaults to `MARKETING` if omitted.

---

## 31. Tasks

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/tasks` · `GET /:id` | List / detail | `project:view` |
| `POST` / `PUT` / `DELETE /api/tasks/:id` | CRUD | `task:edit` |
| `GET` / `POST /api/tasks/:id/comments` · `DELETE /:id/comments/:commentId` | Task discussion | view / `task:edit` |
| `POST /api/tasks/:id/attachments` · `DELETE /:id/attachments/:attachmentId` | Files | `task:edit` |

- Scopeable to project, building **or** unit.
- Status `TODO · IN_PROGRESS · DONE · CANCELLED`; priority `LOW · MEDIUM · HIGH · URGENT` — both CustomOptions.
- Assignee, due date, description.
- **Every role has `task:view` + `task:edit`** (except Legal and Viewer) — tasks are the universal coordination surface.
- Surfaces both at `/tasks` (cross-project, with project/assignee/status filters) and on the project Tasks tab.

---

## 32. Notifications

### 32.1 Endpoints

```
GET  /api/notifications              list for current user
POST /api/notifications/read         mark read
GET  /api/notifications/preferences  per-type preferences
PUT  /api/notifications/preferences  toggle a type on/off
```

No permission gate — every authenticated user manages their own.

### 32.2 The 18 notification types

| Group | Types |
|---|---|
| **Construction** | `MILESTONE_OVERDUE` |
| **Leasing** | `LEASE_EXPIRING_30` · `LEASE_EXPIRING_7` |
| **Debt** | `LOAN_MATURITY_60` |
| **Comments** | `COMMENT_FINANCIAL` · `COMMENT_SALES` · `COMMENT_MARKETING` |
| **Draws** | `DRAW_REQUEST_SUBMITTED` · `DRAW_REQUEST_APPROVED` · `DRAW_REQUEST_FUNDED` |
| **Budget** | `BUDGET_VARIANCE` |
| **Leads** | `LEAD_ASSIGNED` · `LEAD_STATUS_CHANGED` |
| **Interior** | `INTERIOR_PHASE_CHANGED` · `INTERIOR_HANDOVER_DUE` · `SNAG_OVERDUE` |
| **Payments** | `PAYMENT_DUE_7` · `PAYMENT_OVERDUE` |

### 32.3 Channels

- **In-app** — bell icon in the top bar with unread badge, polled every 30 s; `NotificationPanel` popover.
- **Email** — nodemailer/SMTP, **built and working** (`SMTP_*` env vars).
- **WhatsApp** — not built; the outstanding channel from discovery.

### 32.4 Preferences

`/settings/notifications` renders a toggle switch per type, stored as `NotificationPreference` rows. A disabled type is suppressed on both channels.

### 32.5 Daily digest cron

`scheduled-notifications.service.ts` runs **08:00 America/Chicago** daily:

```
runDailyChecks()
  ├── checkOverdueMilestones()   → MILESTONE_OVERDUE
  ├── checkExpiringLeases()      → LEASE_EXPIRING_30 / _7
  ├── checkLoanMaturities()      → LOAN_MATURITY_60
  ├── checkBudgetVariances()     → BUDGET_VARIANCE (> OrgSettings.budgetVarianceAlertPct)
  ├── checkOverdueSnags()        → SNAG_OVERDUE
  └── checkSalePayments()        → PAYMENT_DUE_7 / PAYMENT_OVERDUE
```

---

## 33. Exceptions — "Needs Attention" Feed

`GET /api/exceptions` (gate `project:view`) — one computed feed answering *"what's on fire right now?"*, for the portfolio or a single project.

### The seven sources

| Category | Trigger |
|---|---|
| `milestone` | Overdue milestones |
| `unit` | Available > 90 days (stale inventory) |
| `draw` | Past expected funding date |
| `draw` | Awaiting internal approval (doubles as the **Pending Approvals** surface) |
| `budget` | Category over the variance threshold |
| `lease` | Expiring within 30 days |
| `sale` | No activity for 14+ days |

**Severity:** `critical` (red) · `warning` (amber) · `info` (blue). Each item carries `{ id, severity, category, title, detail, meta, href, createdAt }` — `href` makes every row a one-click jump to the thing that needs fixing.

### Permission filtering — an important subtlety

The expensive `compute()` is **cached permission-agnostically** (60 s, tag `exceptions`), then filtered **per request**:

```
draw  → requires draw:view or financial:view
sale  → requires sales:view
lease → requires lease:view
else  → visible to anyone with project:view
```

The feed carries lender, buyer and tenant names, so a Viewer or PM must not receive draw/sale/lease items. Filtering after the cache keeps one shared compute without a cache-key explosion.

Rendered as `ExceptionFeed` on the dashboards and `ProjectExceptions` on the project Overview tab.

---

## 34. Role Dashboards

Four purpose-built dashboards, all cached and all scoped to the viewer's projects.

### 34.1 Founder / Executive — `/dashboard/founder`

`GET /api/dashboard/founder`

Portfolio-level: total projects by phase, portfolio value, health scores across projects, aggregate budget vs. actual, pipeline value and weighted forecast, exceptions feed, pending approvals (draws awaiting sign-off), recent comments grouped by type, recent activity.

### 34.2 Construction / PM — `/dashboard/construction`

`GET /api/dashboard/construction` — **project-scoped** for field roles.

Milestone status across projects, overdue milestones, recent daily logs with photos, draws in flight, building phase progress, construction tasks. **No financial data** — Construction has neither `financial:view` nor `budget:view`.

### 34.3 Sales / Marketing — `/dashboard/sales`

`GET /api/dashboard/sales` — project-scoped.

Lead funnel by stage, sales pipeline by status, weighted forecast, conversion rates, unit availability, campaign performance, recent lead activity, stale deals.

### 34.4 Finance — `/dashboard/finance`

`GET /api/dashboard/finance` (gate `financial:view`)

Budget vs. actual vs. committed portfolio-wide, cash-flow summary, `ReceivablesWidget` (upcoming sale installments), draws by status, loan balances and monthly debt service, budget variance alerts, capital calls outstanding.

---

## 35. Reports

### 35.1 API

| Endpoint | Report | Gate |
|---|---|---|
| `GET /api/reports/portfolio` | Executive summary | `financial:view` |
| `GET /api/reports/sales-summary` | Sales performance | `sales:view` |
| `GET /api/reports/revenue` | Revenue & leasing | `lease:view` |
| `GET /api/reports/debt` | Debt & financing | `loan:view` |
| `GET /api/reports/unit-sales` | Unit-level sales detail | `sales:view` |
| `GET /api/reports/vacancy` | Vacancy analysis | `sales:view` |

### 35.2 `/reports` — four tabs, role-filtered

| Tab | Metrics | Roles |
|---|---|---|
| **Executive Summary** | Total Investment · Total Revenue · Overall ROI · Closed Sales | Admin, Founder, Exec, Finance, Accounting, PM |
| **Sales Report** | Total Pipeline · Closed Value · Conversion Rate · Avg Days to Close | Admin, Founder, Exec, Sales, Marketing |
| **Revenue & Leasing** | Monthly Rent · Annual Rent · Active Leases · Occupancy | Admin, Founder, Exec, Finance, Sales |
| **Debt & Financing** | Total Principal · Total Balance · Weighted Avg Rate · Monthly Payments | Admin, Founder, Exec, Finance |

All filterable by project.

### 35.3 Role report pages

`/reports/founder` · `/reports/construction` · `/reports/sales` — pre-composed views for each function.

### 35.4 Vacancy report — `/reports/vacancy`

Every available unit with its **time on market**, filterable by project and minimum days vacant (default threshold from `OrgSettings.unitStaleDaysThreshold`). This is the stale-inventory worklist.

---

## 36. KPI Snapshots

| Endpoint | Purpose | Gate |
|---|---|---|
| `GET /api/kpi/latest` | Most recent snapshot | `financial:view` |
| `GET /api/kpi/history` | Trend over time | `financial:view` |
| `POST /api/kpi/snapshot` | Force a snapshot now | `financial:edit` |

`KpiSnapshot` rows freeze portfolio metrics point-in-time so trends survive underlying data changes. A **nightly 02:00 cron** (`kpi-precompute.service.ts`) writes the daily snapshot. `RentRollSnapshot` does the same for the rent roll.

---

## 37. QuickBooks Integration

| Endpoint | Purpose |
|---|---|
| `GET /api/quickbooks/connect` | Start OAuth |
| `GET /api/quickbooks/callback` | OAuth callback (public) |
| `GET /api/quickbooks/status` | Connection state |
| `POST /api/quickbooks/sync` | Trigger sync |
| `GET /api/quickbooks/sync-logs` | Last 20 sync runs |
| `GET` / `POST /api/quickbooks/mappings` | Project → QB class/location mapping |

All gated on `quickbooks:manage` (Finance, Accounting, Founder, Super Admin).

### What it syncs

`syncAll()` pulls **vendors**, **bills**, and **payments**. Bills and payments become `Actual` rows; `findProjectMapping()` resolves the owning project from the QB class/location mapping.

- Access tokens auto-refresh (`refreshAccessToken`).
- `QBSyncLog` records every run (`STARTED · COMPLETED · FAILED`) with counts.
- Unmapped transactions get `qbSyncStatus: UNMAPPED` and budget category `OTHER`, and surface at `GET /api/actuals/unmapped` for manual assignment.
- `QBConnection` stores the realm and encrypted tokens.

**Status:** the OAuth flow and REST sync are fully implemented but **not yet verified against live production credentials** — go-live is a configuration task, not a build task.

---

## 38. Audit Log

`GET /api/audit` (gate `audit:view` — Super Admin, Founder, Executive).

`AuditInterceptor` runs on every mutating controller and writes an immutable `AuditEvent`: actor, action, entity type, entity id, before/after diff, IP, user agent, timestamp.

**Actions:** `CREATE · UPDATE · DELETE · LOGIN · LOGOUT · MFA_VERIFY · EXPORT · QB_SYNC · ROLE_CHANGE`.

Surfaces in two places: the Admin **Audit Log** tab (global, filterable), and the project **Activity** tab (`GET /api/projects/:id/activity`, visible to Super Admin and Founder only) with relative timestamps.

---
---

# Part III — Cross-Cutting

## 39. Scheduled Jobs (Cron) Summary

| Job | Schedule | What it does |
|---|---|---|
| `milestone-overdue-detection` | Daily 00:00 | Flip past-due milestones to `OVERDUE`, emit events |
| `kpi-nightly-precompute` | Daily 02:00 | Write the daily `KpiSnapshot` |
| Daily notification digest | Daily 08:00 **America/Chicago** | 6 checks: overdue milestones · expiring leases (30/7d) · loan maturities (60d) · budget variances · overdue snags · sale payments due/overdue |
| `draw-funding-overdue` | Daily 08:00 | Draws past expected funding date → `drawRequest.fundingOverdue` |
| `sales-stale` | Daily 08:00 | Deals with no activity for `saleActivityDroughtDays` |
| `stale-units` | Daily 08:00 | Units available beyond `unitStaleDaysThreshold` |
| `budget-variance-alerts` | Daily 08:00 | Categories over `budgetVarianceAlertPct` → `budget.varianceExceeded` |

Every threshold is read from `OrgSettings` — none are hard-coded.

---

## 40. Cross-Module Event Wiring

`DrawEventHandlersService` is the "glue layer" that makes the modules feel like one product. Each handler is deliberately short.

| Event | Handler action |
|---|---|
| `milestone.completed` | If the milestone has a `linkedDrawSchedule` → **auto-create a DRAFT DrawRequest**. Also stamps any `ON_MILESTONE` sale installment to DUE. |
| `drawRequest.submitted` | Notify approvers (Super Admin, Founder, Executive, Finance) |
| `drawRequest.approved` | Notify Finance + leadership that the lender package is ready |
| `drawRequest.funded` | **Auto-create Actual rows** · invalidate dashboard caches · notify |
| `drawRequest.fundingOverdue` | Notify Finance + Founder; surface in exceptions |
| `budget.varianceExceeded` | Invalidate dashboard cache; notification |
| `sale.statusChanged` | Recompute health, invalidate caches, notify |
| `interior.phaseChanged` | Notification; on HANDOVER, flip the `ON_HANDOVER` installment to DUE |
| Unit/sale/lease changes | Invalidate `projectHealth` cache tag |

A useful property, stated in the code: *remove the glue layer and every feature still works individually — the system just stops feeling like one product.* Project health is intentionally **not** wired to draws, milestones or variance; it stays unit-based only.

---

## 41. Caching, Soft-Delete & Data Integrity Rules

### Caching

`CacheService.wrap(key, ttlSeconds, computeFn, { tags })` with **tag-based invalidation**. Tags in use: `projectHealth`, `exceptions`, dashboard tags. Domain events call `invalidateTag()` so a status change propagates instantly instead of waiting out a TTL.

TTLs are short (60 s for health and exceptions) — the cache exists to survive a dashboard refresh hammering the DB, not to serve stale data.

### Soft-delete

`deletedAt` on Project, Unit, Sale, Lease, Lead, Campaign, Broker, InteriorProject, Document and more. Every query filters it. CustomOptions soft-delete via `isActive: false`. Nothing is physically removed — combined units, cancelled sales and deactivated brokers all remain queryable for history.

### Concurrency & uniqueness

- **Optimistic locking** on sale close (`updateMany` with a status guard) prevents double commission stamping.
- **Partial unique indexes** — `units_partial_unique_active` (unit number unique among *live* units only, so merged-away numbers can be reused) and `lease_unit_active_unique` (one active lease per unit).
- **Transactions** wrap every multi-write operation: unit combine, lead conversion, sale close, draw transitions.

### Validation patterns

- Polymorphic "exactly one of" checks on Sale, Lease, Lead, Loan, Interior
- Cross-entity ownership checks (the unit must belong to the stated project)
- Date coercion — `@IsDateString()` accepts bare `YYYY-MM-DD`, but Prisma needs full ISO datetimes, so services convert explicitly
- Cycle detection on the milestone dependency DAG

---

## 42. Not Yet Built / Known Caveats

| Item | Status |
|---|---|
| **QuickBooks live go-live** | Code complete; unverified against production credentials. Configuration task. |
| **Bill.com integration** | Not started. Maps to a top client pain point (manual PO re-entry). |
| **BuilderTrend ↔ Bill.com PO bridge** | Not started. The #1 manual-effort pain. |
| **WhatsApp notifications** | Not built. Email and in-app both work. |
| **Buyer portal (CLIENT role)** | Schema ready — `Client` model, `isClientVisible` on documents, `CLIENT` role, buyer-portal doc categories. No UI yet. |
| **Multi-tenant `tenantId`** | Commented in schema, ready to enable. Multi-**org** is already live. |
| **Real-time / WebSocket push** | Not built. Notifications poll every 30 s. |
| **PDF export of reports** | Not built. |
| **PWA / offline mode** | Not built. |
| **Unit Groups** (beyond combine) | `POST /units/combine` covers physical merging; grouping without merging is not built. |

---

## Appendix A — API Route Index

All routes are prefixed `/api` and sit behind `JwtAuthGuard` + `PermissionsGuard`.

| Module | Base route |
|---|---|
| auth | `/auth` |
| users | `/users` |
| organizations | `/organizations` |
| custom-options | `/custom-options` |
| projects · project-health | `/projects` |
| buildings | `/buildings` |
| units | `/units` |
| milestones | `/milestones` |
| budgets | `/budgets` |
| actuals | `/actuals` |
| commitments | `/commitments` |
| contracts | `/contracts` |
| vendors | `/vendors` |
| loans | `/loans` |
| draws | `/draws` |
| sales | `/sales` |
| leases | `/leases` |
| leads | `/leads` |
| campaigns | `/campaigns` |
| brokers | `/brokers` |
| interior | `/interior` |
| daily-logs | `/daily-logs` |
| cashflow | `/cashflow` |
| investors | `/investors` |
| documents | `/documents` |
| comments | `/comments` |
| tasks | `/tasks` |
| notifications | `/notifications` |
| exceptions | `/exceptions` |
| dashboard | `/dashboard` |
| reports | `/reports` |
| kpi | `/kpi` |
| quickbooks | `/quickbooks` |
| audit | `/audit` |

---

## Appendix B — Environment Variables

```env
DATABASE_URL=postgresql://prime:prime_secret@localhost:5432/prime_tracker?schema=public
API_PORT=3001
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
NODE_ENV=development

# Auth
GOOGLE_ALLOWED_DOMAIN=primedevelopers.com
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
ENCRYPTION_KEY=<AES-256-GCM key — must be carried across environment moves>

# Storage (S3)
AWS_REGION=us-east-1
S3_BUCKET=<bucket>

# Email (optional — omit for in-app-only notifications)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=notifications@primedevelopers.com
SMTP_PASS=<password>
SMTP_FROM=PrimeTracker <noreply@primedevelopers.com>
APP_BASE_URL=http://localhost:5173
```

---

*Generated 28 July 2026 from the live codebase. When the code changes, regenerate rather than hand-editing — the value of this document is that it matches what actually ships.*
