# Prime Tracker — CLAUDE.md

Complete context file. Read this before making any changes.

> **Maintenance note (2026-05-30):** This file was refreshed to match the actual codebase, which had grown
> well beyond the original doc (~38 API modules, ~24 web pages, 19 migrations, 14 user roles). Post-discovery
> planning lives in `docs/client-discovery/` (UPDATE_PLAN, INTERIOR_MODULE_DESIGN, SALE_PAYMENT_SCHEDULE_DESIGN).

---

## What This App Is

**Prime Tracker** is an internal real-estate project management platform for **Prime Developers**.
It tracks construction projects, buildings, units, financials, sales, leases, loans, milestones, leads,
campaigns, contracts/vendors, investors, documents, tasks, and team comments — with role-based dashboards.

- Single-tenant data today, but **multi-org is live** (`Organization` model — Prime runs US + India entities)
- Multi-tenant (`tenantId`) still commented in schema for the future
- Used by: Founders/Executives, Finance/Accounting/AR-AP, Project Managers, Sales, Marketing, Construction, Legal, Viewers, and (Phase 2) buyer-portal Clients

---

## Monorepo Structure

```
prime-tracker/
├── apps/
│   ├── api/           NestJS backend (REST API)
│   └── web/           React frontend (Vite)
├── infra/
│   ├── docker/        docker-compose.yml
│   └── scripts/       setup.sh
├── pnpm-lock.yaml
└── package.json       root workspace
```

---

## Tech Stack

### Backend (`apps/api`)
| Concern | Choice |
|---|---|
| Framework | NestJS |
| ORM | Prisma v5 |
| Database | PostgreSQL (`prime_tracker` db, localhost:5432) |
| Auth | JWT (access 15m / refresh 7d) + Google OAuth (Workspace SSO) |
| API docs | Swagger at `http://localhost:3001/api/docs` |
| Job queues | BullMQ + Redis |
| MFA | TOTP |
| Encryption | AES-256-GCM for sensitive fields (loans) |

### Frontend (`apps/web`)
| Concern | Choice |
|---|---|
| Framework | React 18 + Vite |
| UI Library | **HeroUI** (NOT Chakra UI — fully migrated) |
| State | Zustand (auth store, persisted) |
| Data fetching | TanStack Query v5 |
| HTTP client | Axios with interceptors (auto token refresh, 401 handling) |
| Routing | React Router v6 |
| Icons | react-icons (Fi prefix = Feather icons) |
| Charts | Recharts |
| Styling | Tailwind CSS v4 |

### Dev Ports
- **API**: `http://localhost:3001`
- **Web**: `http://localhost:5173` (proxies `/api` → `localhost:3001`)

### Run Everything
```bash
pnpm run dev          # starts both api + web in parallel
pnpm run db:migrate   # prisma migrate dev
pnpm run db:seed      # prisma db seed
pnpm run db:studio    # prisma studio GUI
```

---

## Data Hierarchy

```
Organization (US / India entities)
  └── Project
        └── Buildings (1:many)   ← can be type LOT (raw land, acreage, no units)
              └── Units (1:many)
                    ├── Leases    (or attached to Building directly — polymorphic)
                    ├── Sales     (or attached to Building directly — polymorphic)
                    ├── Loans     (Project / Building / Unit level — polymorphic)
                    └── UnitComments (with CommentType)
        ├── ProjectComments (with CommentType)
        ├── Milestones (+ dependencies, + MilestonePhotos)
        ├── BudgetLines (+ BudgetRevisions, append-only history)
        ├── Commitments / Contracts (+ ChangeOrders, ContractPayments) / Actuals
        ├── Loans → DrawRequests (+ DrawApprovals, DrawDocuments) / DrawSchedules
        ├── Sales / Leads (+ LeadActivities) / Campaigns (+ CampaignSpend)
        ├── CashFlowEntries
        ├── Investors → EquityPositions / CapitalCalls / Distributions
        ├── Documents (+ DocumentVersions) — also attach to Building/Unit/Sale/Lead
        ├── Tasks (+ TaskComments, TaskAttachments)
        └── KpiSnapshots / RentRollSnapshots
```

Key polymorphism: **Sale, Lease, Lead, Loan** can attach to a Unit *or* a Building (service-enforced
"exactly one of"). Buildings have their own `phase`; `Project.phase` is computed = max(building phases).

---

## Prisma Schema Key Models

File: `apps/api/prisma/schema.prisma`

### Enums (current — verify in schema before relying)
```
UserRole:      SUPER_ADMIN | FOUNDER | EXECUTIVE | FINANCE | ACCOUNTING | AR_AP |
               PROJECT_MANAGER | CONSTRUCTION | SALES | MARKETING | LEGAL | VIEWER | CLIENT
OrgRole:       LEAD | EMPLOYEE
ProjectStatus: ACTIVE | ON_HOLD | COMPLETED | CANCELLED
ProjectPhase:  PRE_DEVELOPMENT | PERMITTING | CONSTRUCTION | LEASE_UP | STABILIZED | SOLD_REFI
ProjectType:   RESIDENTIAL | COMMERCIAL | MIXED_USE | INDUSTRIAL
BuildingType:  RESIDENTIAL | COMMERCIAL | MIXED_USE | INDUSTRIAL | PARKING | AMENITY |
               RETAIL | OFFICE | LOT   ← LOT = raw land parcel (acreage, usually no units)
UnitType:      RETAIL | MEDICAL | FLEX | RESIDENTIAL_LOT | COMMERCIAL_LOT | OFFICE | RESTAURANT | EVENT_CENTER
UnitStatus:    AVAILABLE | UNDER_CONTRACT | LEASED | LEASE_PENDING | SOLD | OCCUPIED | UNDER_CONSTRUCTION
CommentType:   MARKETING | SALES | FINANCIAL
MilestoneStatus: NOT_STARTED | IN_PROGRESS | COMPLETED | OVERDUE | BLOCKED
LoanType:      CONSTRUCTION | PERMANENT | BRIDGE | MEZZANINE | SBA
DrawStatus:    DRAFT | SUBMITTED | APPROVED | FUNDED | REJECTED | CANCELLED
DrawApprovalStep: INTERNAL_FOUNDER | INTERNAL_FINANCE | LENDER_SUBMITTED | LENDER_FUNDED
SaleStatus:    PROSPECT | LOI_SIGNED | UNDER_CONTRACT | CLOSED | CANCELLED
LostReason:    PRICE_TOO_HIGH | FINANCING_FELL_THROUGH | CHOSE_COMPETITOR | TIMING_OFF | NO_RESPONSE | OTHER
LeaseStatus:   DRAFT | ACTIVE | EXPIRED | TERMINATED | OWNER_OCCUPIED
LeadSource:    WEBSITE | SOCIAL_MEDIA | REFERRAL | COLD_CALL | WALK_IN | SIGNAGE | EMAIL_CAMPAIGN | BROKER | OTHER
LeadStatus:    NEW | CONTACTED | QUALIFIED | PROPOSAL_SENT | NEGOTIATING | CONVERTED | LOST | DEAD
LeadActivityType: CALL | EMAIL | MEETING | SITE_VISIT | FOLLOW_UP | NOTE | STATUS_CHANGE
CampaignChannel: META | GOOGLE_ADS | NEWSPAPER | BROKER | EMAIL | SIGNAGE | EVENT | OTHER
NotificationType: MILESTONE_OVERDUE | LEASE_EXPIRING_30/_7 | LOAN_MATURITY_60 |
                  COMMENT_FINANCIAL/_SALES/_MARKETING | DRAW_REQUEST_APPROVED/_FUNDED |
                  BUDGET_VARIANCE | LEAD_ASSIGNED | LEAD_STATUS_CHANGED
CashFlowType:  INFLOW | OUTFLOW
DocCategory:   GENERAL | PERMIT | CONTRACT | FINANCIAL | DRAWING | PHOTO | LEGAL | BROCHURE |
               LOI | DEED | BOOKING_AGREEMENT | RECEIPT | NOC | POSSESSION_CERTIFICATE
BudgetCategory: LAND_ACQUISITION | SITE_WORK | HARD_COSTS | SOFT_COSTS | FINANCING |
                PERMITS_FEES | CONTINGENCY | MARKETING | LEGAL | OTHER
TaskStatus:    TODO | IN_PROGRESS | DONE | CANCELLED   ·   TaskPriority: LOW | MEDIUM | HIGH | URGENT
```

### Key Models (schema is ~1,575 lines — this is the map, not the territory)
- **Organization / OrgMembership** — multi-entity (US + India); projects belong to an org
- **Project** — core entity; `phase` is computed from building phases; soft-delete (`deletedAt`)
- **Building** — type LOT supports raw-land/acreage; has own `phase`, `coverPhotoPath`
- **Unit** — belongs to Building; `primeOwned`, `availableSince` (time-on-market), soft-delete
- **Milestone** — `dependsOnId` (DAG, cycle-checked), `linkedDrawScheduleId`, `MilestonePhoto`s
- **BudgetLine / BudgetRevision** — append-only revision history; `revisedAmt` mirrors latest
- **Loan** — Project/Building/Unit polymorphic; AES-encrypted sensitive fields; `DrawRequest`/`DrawSchedule`
- **DrawRequest** — multi-step approval (`DrawApproval`), `DrawDocument`s (lien waiver/inspection…)
- **Sale** — Unit/Building polymorphic; `lostReason`, `expectedCloseDate`, `lastActivityAt`; auto-flips unit→SOLD on close
- **Lead** — Unit/Building polymorphic; UTM/campaign attribution; `convertToSale`
- **Campaign / CampaignSpend** — marketing spend + lead attribution
- **Contract / ChangeOrder / ContractPayment / Vendor** — vendor contract tracking
- **Investor / EquityPosition / CapitalCall / Distribution** — investor relations
- **Document / DocumentVersion** — versioned; attaches to project/building/unit/sale/lead; `isClientVisible` (buyer portal); Supabase storage or `externalUrl`
- **CashFlowEntry** — INFLOW/OUTFLOW for the cashflow forecast
- **Task / TaskComment / TaskAttachment** — work tracking, per project/building
- **AuditEvent** — immutable audit log

### Migration History (19 migrations — most recent last)
```
20260228201401_init
20260301214135_add_project_type
20260302035913_add_comments_ownership_unit_loans
20260302134952_add_comment_type_project_comments
20260303030247_add_leads_notifications
20260305042323_add_tasks
20260305162611_add_organizations
20260314151805_add_new_user_roles
20260502000000_add_project_members
20260502120000_add_rls_4_modules
20260503000000_add_building_type_draw_approver
20260503010000_add_draw_schedule
20260504000000_add_soft_delete_and_indexes
20260505000000_seven_features_foundation
20260508000000_add_document_storage_path
20260509000000_doc_vault_phase_1
20260520000000_add_lead_unit_link
20260520120000_sprint1_schema_realignment
20260520130000_sprint2_campaigns_and_attribution   ← most recent
```
Always run `npx prisma migrate status` before writing a new migration.

---

## API Modules & Routes

All routes prefixed with `/api`. Auth guard on everything.

~38 modules registered in `app.module.ts`. Base routes (from `@Controller(...)`):

| Module | Base Route | Notes |
|---|---|---|
| auth | `/api/auth` | Google OAuth, JWT, refresh, MFA (TOTP) |
| users | `/api/users` | RBAC, role/status management |
| organizations | `/api/organizations` | Multi-entity (US/India), memberships |
| projects | `/api/projects` | CRUD + `/dashboard` endpoint |
| project-health | `/api/project-health` | Computed health score |
| buildings | `/api/buildings` | Full CRUD, `GET ?projectId=`; LOT support |
| units | `/api/units` | CRUD, `GET ?projectId=`, lease-income |
| budgets | `/api/budgets` | Budget lines + revisions, summary |
| actuals | `/api/actuals` | Actual spend records |
| commitments | `/api/commitments` | Vendor commitments |
| contracts | `/api/contracts` | Contracts + change orders + payments |
| vendors | `/api/vendors` | Vendor master |
| loans | `/api/loans` | Loans, monthly-payments |
| draws | `/api/draws` | Draw requests + approvals + schedule + docs |
| leases | `/api/leases` | Leases + rent-roll |
| milestones | `/api/milestones` | Milestones + dependencies + photos |
| sales | `/api/sales` | Sales pipeline + weighted forecast |
| leads | `/api/leads` | Leads + activities + convert-to-sale |
| campaigns | `/api/campaigns` | Marketing campaigns + spend + attribution |
| cashflow | `/api/cashflow` | Cashflow forecast (inflow/outflow) |
| investors | `/api/investors` | Equity, capital calls, distributions |
| documents | `/api/documents` | Versioned docs, presigned upload (Supabase) |
| comments | `/api/comments` | Unit + Project comments (see below) |
| tasks | `/api/tasks` | Tasks + comments + attachments |
| exceptions | `/api/exceptions` | Delay/blocker/risk feed (computed) |
| notifications | `/api/notifications` | In-app + email; preferences; daily cron |
| reports | `/api/reports` | portfolio, sales, revenue, debt, unit-sales, vacancy |
| dashboard | `/api/dashboard` | Role dashboard aggregates |
| kpi | `/api/kpi` | KPI snapshots |
| audit | `/api/audit` | Immutable audit log |
| quickbooks | `/api/quickbooks` | QB OAuth + REST sync (vendors/bills/payments) — needs live creds |

Also present: `common/` (cache, events EventBus, health, storage), `PrismaModule`. Several modules have
**RLS** applied (migration `add_rls_4_modules`).

### Comments API (important — non-standard routes)
```
GET    /api/comments?unitId=:id        list unit comments
GET    /api/comments?projectId=:id     list project comments
GET    /api/comments/recent?limit=20   recent across all (both types, sorted by CommentType)
POST   /api/comments                   create — body: { unitId? | projectId?, content, commentType? }
PUT    /api/comments/unit/:id          update unit comment
PUT    /api/comments/project/:id       update project comment
DELETE /api/comments/unit/:id          delete unit comment
DELETE /api/comments/project/:id       delete project comment
```

---

## Frontend Structure

### Pages (`apps/web/src/pages/` — ~24 pages)
| File | Route | Notes |
|---|---|---|
| `LoginPage.tsx` | `/login` | Google OAuth login |
| `AuthCallbackPage.tsx` | `/auth/callback` | OAuth callback handler |
| `DashboardPage.tsx` | `/` | Portfolio overview (RootRedirect routes by role) |
| `FounderDashboardPage.tsx` | `/dashboard/founder` | Role dashboard |
| `FinanceDashboardPage.tsx` | `/dashboard/finance` | Role dashboard |
| `SalesDashboardPage.tsx` | `/dashboard/sales` | Role dashboard |
| `ConstructionDashboardPage.tsx` | `/dashboard/construction` | Role dashboard |
| `LeadDashboardPage.tsx` | `/leads/dashboard` | Lead pipeline dashboard |
| `ProjectsPage.tsx` | `/projects` | Project list with filters |
| `ProjectDetailPage.tsx` | `/projects/:id/:tab?` | Main project view (11 tabs — see below) |
| `UnitDetailPage.tsx` | `/projects/:id/units/:unitId` | Unit detail (overview/comments/documents) |
| `BuildingDetailPage.tsx` | `/projects/:id/buildings/:buildingId` | Building detail (perm `building:view`) |
| `InventoryPage.tsx` | `/inventory` | Cross-project unit inventory |
| `LeadsPage.tsx` | `/leads` | Cross-project leads |
| `CampaignsPage.tsx` | `/campaigns` | Marketing campaigns (perm `campaign:view`) |
| `InvestorsPage.tsx` / `InvestorDetailPage.tsx` | `/investors`, `/investors/:id` | perm `investor:view` |
| `TasksPage.tsx` | `/tasks` | Cross-project tasks |
| `ReportsPage.tsx` | `/reports` | Cross-project reports |
| `FounderReportsPage.tsx` / `SalesReportsPage.tsx` / `ConstructionReportsPage.tsx` | `/reports/{founder,sales,construction}` | Role reports |
| `VacancyReportPage.tsx` | `/reports/vacancy` | perm `sales:view` |
| `SettingsPage.tsx` | `/settings/notifications` | Notification preferences |
| `AdminPage.tsx` | `/admin/*` | User management (perm `user:manage`) |

### ProjectDetailPage Tabs (in order — role-filtered via `TAB_ROLES`)
```
overview → construction → revenue → units → milestones → leads → draws → vendors → documents → tasks → comments
```
TAB_MAP: `['overview','construction','revenue','units','milestones','leads','draws','vendors','documents','tasks','comments']`
- **construction** tab = Buildings + Budget/Costs (composes `BuildingsTab` + `FinancialsTab`)
- **revenue** tab = Sales pipeline + Leases/Rent-roll (composes `SalesTab` + `LeasesTab`)
- Tabs are filtered per role; users only see tabs their role allows.

Navigate programmatically: `navigate('/projects/:id/comments')` etc.

### Key Components (`apps/web/src/components/`)
- `Layout.tsx` — Sidebar + TopBar. Sidebar shows **Prime Developers logo** (not a text/icon)
- `ui.tsx` — Shared components: `StatCard`, `StatusBadge`, `PhaseProgress`, `LoadingState`, `ErrorState`, `EmptyState`, `PermissionGate`, `fmt`, `fmtPct`, `fmtDate`

### State Management
- Auth: `apps/web/src/store/authStore.ts` (Zustand + persist)
  - `user`, `accessToken`, `refreshToken`, `isAuthenticated`
  - `hasPermission(permission)`, `hasAnyPermission(...permissions)`
- Server state: TanStack Query (all in `useApi.ts`)

### API Hooks (`apps/web/src/hooks/useApi.ts`)
All hooks exported from single file. Key ones:
```ts
useDashboard()
useProjects(params?)
useProject(id)
useBuildings(projectId)         useCreateBuilding()  useUpdateBuilding()  useDeleteBuilding()
useUnits(projectId)             useCreateUnit()      useUpdateUnit()      useDeleteUnit()
useUnit(id)
useUnitComments(unitId)         → queryKey: ['comments', 'unit', unitId]
useProjectComments(projectId)   → queryKey: ['comments', 'project', projectId]
useRecentComments(limit?)
useCreateComment()              → accepts { unitId? | projectId?, content, commentType? }
useDeleteComment()              → accepts { id, source: 'unit' | 'project' }
useMilestones(projectId)        useCreateMilestone() useUpdateMilestone() useDeleteMilestone()
useLoans(projectId)
useLeases(projectId)            useCreateLease()     useUpdateLease()     useDeleteLease()
useSalesPipeline(projectId)     useCreateSale()      useUpdateSale()      useDeleteSale()
useFinancialSummary(projectId)
useBudgetLines(projectId)       useCreateBudget()    useUpdateBudget()    useDeleteBudget()
useCommitments(projectId)       useCreateCommitment() useUpdateCommitment() useDeleteCommitment()
useMonthlyLeaseIncome(projectId)
useMonthlyPayments(projectId)
useRentRoll(projectId)
useUpdateProject()
useCreateProject()  useDeleteProject()
useUsers()  useUpdateUserRole()  useToggleUserActive()  useCreateUser()
usePortfolioReport()  useSalesReport()  useRevenueReport()  useDebtReport()
// Plus many more (draws, contracts, vendors, documents, investors, campaigns, tasks,
// exceptions, project-health, milestone-photos, presigned-upload, etc.) — useApi.ts is
// the single source of truth. grep there rather than trusting this list.
```

---

## Comments System

### Types & Colors
```
MARKETING → purple  (bg-purple-100 text-purple-700)
SALES     → blue    (bg-blue-100 text-blue-700)
FINANCIAL → green   (bg-green-100 text-green-700)
```

### Sort Order (always in this order)
`MARKETING → SALES → FINANCIAL` then by `createdAt desc` within each group

### Where Comments Appear
1. **Dashboard** (`DashboardPage.tsx`) — `d.recentComments` from `/api/projects/dashboard`, grouped by type with colored section headers
2. **Project Comments Tab** (`ProjectDetailPage.tsx` → `ProjectCommentsTab`) — project-level comments with type filter chips
3. **Units Tab** → comment modal (`UnitCommentsPanel`) — per-unit comments with type selector
4. **Unit Detail Page** (`UnitDetailPage.tsx` → `InlineComments`) — full unit comment thread with type selector

### Adding a comment
Always pass `commentType` (defaults to `MARKETING` if omitted in service layer).

---

## Brand & Assets

### Logo Files (in `apps/web/public/`)
```
/logo-full-blue.png      Full horizontal logo, blue — used in expanded sidebar
/logo-full-white.png     Full horizontal logo, white — for dark backgrounds
/logomark-blue.png       Icon-only mark, blue — used in collapsed sidebar
/logomark-white.png      Icon-only mark, white
```

### Source Assets
```
/Users/mallikg/Documents/prime/prime website assets/
  PRIME DEVELOPERS.pdf                    Brand guidelines PDF
  PRIME DEVELOPERS-  FINAL DELIVERY/
    LOGO DESIGN/
      TRANSPARENT FILE/
        RGB TRANSPARENT FILES/
          PNG FILES- RGB/    ← source PNGs (Full Logo, Logomark, Typo variants)
          SVG FILES- RGB/
```

### Layout Logo Logic
```tsx
// Layout.tsx Sidebar
collapsed ? <img src="/logomark-blue.png" h-8 w-8 />
          : <img src="/logo-full-blue.png" h-10 />
```

---

## Buildings → Units Hierarchy (UI)

- **Buildings Tab** in ProjectDetailPage: full CRUD (create/edit/delete buildings)
  - Card grid showing unit count, sqft, stories per building
- **Units Tab**: units grouped by building in collapsible cards
  - Filter dropdown to show only one building's units
  - Creating a unit requires selecting a building (required field)
- Units do NOT live directly under a project — they must belong to a Building

---

## Auth & Permissions

### Permission strings (used with `RequirePermissions` decorator and `hasPermission()`)
```
unit:view       building:view / building:edit     user:manage (admin)
sales:view      lead:view                         campaign:view
investor:view   ...and more — grep the codebase for the full set
```
14 roles map to permission sets in `apps/api/src/modules/auth/`. Frontend routes gate on these
(see `App.tsx` `<ProtectedRoute permission="...">`), and ProjectDetailPage tabs filter via `TAB_ROLES`.

### Role → Permissions mapping
Defined in `apps/api/src/modules/auth/` (permissions guard checks JWT claims).

### Auth Flow
1. User clicks "Sign in with Google" → `/api/auth/google`
2. OAuth callback → JWT issued, stored in Zustand (persisted to localStorage)
3. Axios interceptor attaches `Authorization: Bearer <token>` to all requests
4. On 401 → auto-refresh using refresh token → retry original request
5. If refresh fails → logout → redirect to `/login`

---

## Key Patterns & Conventions

### API (NestJS)
- Every controller uses `@UseGuards(JwtAuthGuard, PermissionsGuard)` + `@UseInterceptors(AuditInterceptor)`
- `@CurrentUser('sub')` → userId, `@CurrentUser('role')` → role string
- `@RequirePermissions('...')` decorator on each route
- Services throw `NotFoundException` / `ForbiddenException` directly
- Prisma errors bubble up (no global transform needed in dev)

### Frontend (React)
- `errMsg(err, fallback)` helper used everywhere for API error toasts
- `addToast({ title, color })` from HeroUI for notifications
- Form state is always `Record<string, string>` — parse to numbers/dates in the save handler
- `useDisclosure()` from HeroUI for modal open/close state
- `set(field)` helper pattern: `(e) => setForm(f => ({ ...f, [field]: e.target.value }))`
- Empty form constants (e.g. `EMPTY_UNIT`, `EMPTY_BUILDING`) reset state on "Add" vs "Edit"

### HeroUI Components Used
`Card, CardBody, CardHeader, Button, Tabs, Tab, Modal, ModalContent, ModalHeader, ModalBody, ModalFooter, Input, Select, SelectItem, Textarea, Avatar, Chip, Badge, Switch, Progress, Tooltip, Dropdown, DropdownTrigger, DropdownMenu, DropdownItem, useDisclosure, addToast`

---

## Environment Variables (`.env` in `apps/api/`)

```env
DATABASE_URL=postgresql://prime:prime_secret@localhost:5432/prime_tracker?schema=public
API_PORT=3001
FRONTEND_URL=http://localhost:5173
CORS_ORIGINS=http://localhost:5173
NODE_ENV=development
GOOGLE_ALLOWED_DOMAIN=primedevelopers.com
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d
# Email (optional — skip for in-app only)
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=notifications@primedevelopers.com
SMTP_PASS=yourpassword
SMTP_FROM=PrimeTracker <noreply@primedevelopers.com>
APP_BASE_URL=http://localhost:5173
```

---

## Notifications Module (`apps/api/src/modules/notifications/`)
- `notifications.service.ts` — core send(), findForUser(), markRead(), getPreferences(), setPreference(), named triggers (notifyMilestoneOverdue etc.)
- `notifications.controller.ts` — GET /notifications, POST /notifications/read, GET/PUT /notifications/preferences
- `scheduled-notifications.service.ts` — cron daily 8AM CT checks: overdue milestones, expiring leases (30/7d), maturing loans (60d), budget variances >10%
- `notifications.module.ts` — exports NotificationsService

Frontend:
- Bell icon with unread badge in TopBar (Layout.tsx, polls every 30s)
- NotificationPanel popover from bell icon
- `/settings/notifications` — SettingsPage.tsx with toggle switches per type
- Route added to App.tsx

## Leads Module (`apps/api/src/modules/leads/`)
- `leads.service.ts` — CRUD + addActivity() + convertToSale()
- `leads.controller.ts` — GET/POST/PUT/DELETE /leads, GET/POST /leads/:id/activities, POST /leads/:id/convert
- `leads.module.ts`

Frontend:
- `/leads` — LeadsPage.tsx (cross-project list, filter by status/search, activity timeline side panel)
- Leads tab in ProjectDetailPage.tsx (per-project leads + activity timeline)
- Route added to App.tsx
- Nav item in Layout.tsx sidebar (FiTarget icon)

## MFA Module
- Backend: `/auth/mfa/setup`, `/auth/mfa/enable`, `/auth/mfa/verify` already existed
- Frontend: MfaSetupModal.tsx (4-step flow: intro → QR → verify → done)
- Triggered from user dropdown in TopBar and MfaBanner for FINANCE/FOUNDER roles

---

## Post-Discovery Roadmap (client answered the discovery workbook — 2026-05-30)

Full analysis in **`docs/client-discovery/`**:
- `UPDATE_PLAN.md` — master gap analysis (most original "gaps" turned out already built)
- `INTERIOR_MODULE_DESIGN.md` — converged design for the Interior/Fit-Out module (the big new build)
- `SALE_PAYMENT_SCHEDULE_DESIGN.md` — installments tied to milestones (feeds cashflow)

### Confirmed remaining work (priority order)
1. 🔴 **Interior / Fit-Out module** (new) — InteriorProject + 7 phases + isolated TI budget + sub-contractor invoices + snagging. Same PM, per-sqft, no parallel execution before shell complete.
2. 🔴 **Sale Payment Schedule** — `SalePayment` child of Sale, milestone-linked; build *with* Interior (TI is one installment).
3. 🟠 **Broker model + commissions + broker report** (currently only a `BROKER` enum string).
4. 🟠 **Unit Groups** — combine adjacent units → merge into one legal unit.
5. 🟠 **Snagging / punch list** — delivered inside the Interior module.
6. 🟠 **Daily construction logs with photos** — client's #1 pain point.
7. 🟠 **BuilderTrend ↔ Bill.com PO bridge** — top manual-effort pain (kill manual PO re-entry).
8. 🟢 WhatsApp notifications, lead stage tweaks (+POTENTIAL/+SITE_VISIT, multi-unit interest), PWA/offline.

## Things NOT Yet Built / Caveats
- **QuickBooks** — OAuth + REST sync code is real but unverified against live credentials (go-live is a task, not new build).
- **Bill.com / BuilderTrend** integrations — not started (net-new; maps to top client pain points).
- Multi-tenant `tenantId` — commented in schema, ready to enable (multi-**org** already live).
- Push / real-time (WebSocket) — not built; notifications poll every 30s.
- PDF export of reports — not built.
- **Email notifications ARE built** (nodemailer/SMTP) — WhatsApp channel is the outstanding one.
