# Prime Tracker — CLAUDE.md

Complete context file. Read this before making any changes.

---

## What This App Is

**Prime Tracker** is an internal real-estate project management platform for **Prime Developers**.
It tracks construction projects, buildings, units, financials, sales, leases, loans, milestones, and team comments.

- Single-tenant today, multi-tenant ready (tenantId fields commented out in schema)
- Used by: Founders, Finance, Project Managers, Sales, Construction teams

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
Project
  └── Buildings (1:many)
        └── Units (1:many)
              ├── Leases
              ├── Sales
              ├── Loans (optional link)
              └── UnitComments (with CommentType)
  ├── ProjectComments (with CommentType)
  ├── Milestones
  ├── BudgetLines
  ├── Commitments
  ├── Actuals
  ├── Loans
  ├── Sales
  └── KpiSnapshots
```

---

## Prisma Schema Key Models

File: `apps/api/prisma/schema.prisma`

### Enums
```
UserRole:      FOUNDER | FINANCE | PROJECT_MANAGER | SALES | CONSTRUCTION | VIEWER
ProjectStatus: ACTIVE | ON_HOLD | COMPLETED | CANCELLED
ProjectPhase:  PRE_DEVELOPMENT | PERMITTING | CONSTRUCTION | LEASE_UP | STABILIZED | SOLD_REFI
ProjectType:   RESIDENTIAL | COMMERCIAL | MIXED_USE | INDUSTRIAL
UnitType:      RETAIL | MEDICAL | FLEX | RESIDENTIAL_LOT | OFFICE | RESTAURANT | EVENT_CENTER
UnitStatus:    AVAILABLE | UNDER_CONTRACT | LEASED | SOLD | OCCUPIED | UNDER_CONSTRUCTION
CommentType:   MARKETING | SALES | FINANCIAL   ← added in migration 20260302134952
LoanType:      CONSTRUCTION | PERMANENT | BRIDGE | MEZZANINE | SBA
SaleStatus:    PROSPECT | LOI_SIGNED | UNDER_CONTRACT | CLOSED | CANCELLED
LeaseStatus:   DRAFT | ACTIVE | EXPIRED | TERMINATED
BudgetCategory: LAND_ACQUISITION | SITE_WORK | HARD_COSTS | SOFT_COSTS | FINANCING |
                PERMITS_FEES | CONTINGENCY | MARKETING | LEGAL | OTHER
```

### Key Models
- **Project** — core entity, has `projectType` field (added early)
- **Building** — belongs to Project, has `name`, `totalSqft`, `stories`, `buildingType`
- **Unit** — belongs to Building (NOT directly to Project), has `primeOwned` boolean
- **UnitComment** — belongs to Unit + User, has `commentType: CommentType`
- **ProjectComment** — belongs to Project + User, has `commentType: CommentType`
- **Loan** — can be linked to a Project AND optionally a Unit

### Migration History
```
20260228201401_init
20260301214135_add_project_type
20260302035913_add_comments_ownership_unit_loans
20260302134952_add_comment_type_project_comments  ← most recent
```

---

## API Modules & Routes

All routes prefixed with `/api`. Auth guard on everything.

| Module | Base Route | Notes |
|---|---|---|
| auth | `/api/auth` | Google OAuth, JWT, refresh, MFA |
| users | `/api/users` | RBAC, role/status management |
| projects | `/api/projects` | CRUD + `/dashboard` endpoint |
| buildings | `/api/buildings` | Full CRUD, `GET ?projectId=` |
| units | `/api/units` | CRUD, `GET ?projectId=`, lease-income |
| budgets | `/api/budgets` | Budget lines, summary |
| actuals | `/api/actuals` | Actual spend records |
| loans | `/api/loans` | Loans + draw requests, monthly-payments |
| leases | `/api/leases` | Leases + rent-roll |
| milestones | `/api/milestones` | Project milestones |
| commitments | `/api/commitments` | Vendor commitments |
| sales | `/api/sales` | Sales pipeline |
| comments | `/api/comments` | Unit + Project comments (see below) |
| reports | `/api/reports` | portfolio, sales-summary, revenue, debt |
| kpi | `/api/kpi` | KPI snapshots |
| audit | `/api/audit` | Immutable audit log |
| quickbooks | `/api/quickbooks` | QB integration |

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

### Pages (`apps/web/src/pages/`)
| File | Route | Notes |
|---|---|---|
| `LoginPage.tsx` | `/login` | Google OAuth login |
| `AuthCallbackPage.tsx` | `/auth/callback` | OAuth callback handler |
| `DashboardPage.tsx` | `/` | Portfolio overview, charts, recent comments |
| `ProjectsPage.tsx` | `/projects` | Project list with filters |
| `ProjectDetailPage.tsx` | `/projects/:id/:tab?` | Main project view (8 tabs) |
| `UnitDetailPage.tsx` | `/projects/:id/units/:unitId` | Unit detail with comments |
| `ReportsPage.tsx` | `/reports` | 4 cross-project report tabs |
| `AdminPage.tsx` | `/admin` | User management (FOUNDER only) |

### ProjectDetailPage Tabs (in order)
```
overview → financials → buildings → units → milestones → leases → sales → comments
```
TAB_MAP array: `['overview', 'financials', 'buildings', 'units', 'milestones', 'leases', 'sales', 'comments']`

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
unit:view      — view units and comments
building:view  — view buildings
building:edit  — create/edit/delete buildings
user:manage    — admin functions (FOUNDER only)
```

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

## Things NOT Yet Built (future work)
- QuickBooks sync (endpoints exist, integration pending QB credentials)
- Multi-tenant support (tenantId fields commented in schema, ready to enable)
- Push notifications / real-time updates (no WebSocket yet)
- File attachments on comments or units
- PDF export of reports
- Lead → Sale convert UI (built — "Convert to Sale" button in detail panel and project Leads tab)
