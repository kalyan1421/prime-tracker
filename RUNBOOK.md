# Prime Tracker — Internal Real Estate Development Dashboard

## Step 0: Goals, Assumptions & Build Checklist

### Goals
1. Build an internal project-tracking and financial dashboard for Prime Developers (~30 employees)
2. Track projects through phases: pre-dev → permitting → construction → lease-up → stabilized → sold/refi
3. Financial visibility: budget vs actual vs forecast, loan tracking, rent rolls, KPI snapshots
4. QuickBooks integration for syncing actuals (vendors, bills, expenses, payments)
5. Google Workspace SSO with enforced MFA, RBAC, audit logging
6. Single-tenant now, multi-tenant ready architecture

### Assumptions (labeled ASSUMPTION)
- ASSUMPTION: Google Workspace domain is already configured; we use OIDC for SSO
- ASSUMPTION: QuickBooks Online (not Desktop) is the accounting system
- ASSUMPTION: Redis is acceptable for BullMQ job queues
- ASSUMPTION: PostgreSQL 15+ is the target DB version
- ASSUMPTION: TOTP (RFC 6238) is the primary MFA method for step-up auth
- ASSUMPTION: JWT access + refresh tokens with short-lived access (15min) and rotating refresh (7d)
- ASSUMPTION: Field-level encryption uses AES-256-GCM with keys from env vars
- ASSUMPTION: The app runs on port 3001 (API) and 5173 (frontend dev)
- ASSUMPTION: Chakra UI v2 for component library (consistent, accessible, good for dashboards)
- ASSUMPTION: pnpm as package manager for monorepo workspace
- ASSUMPTION: Node.js 20+ LTS

### Build Checklist
- [x] Step 0: Goals, assumptions, checklist
- [x] Step 1: Repo plan and folder structure
- [x] Step 2: Database schema + Prisma models + migrations + seed
- [x] Step 3: Backend NestJS with auth/RBAC/audit and core CRUD APIs
- [x] Step 4: Frontend React with auth flow, role-based nav, dashboards
- [x] Step 5: QuickBooks integration (OAuth, sync, mapping, reconciliation)
- [x] Step 6: Security hardening (MFA step-up, rate limit, audit immutability, encryption)
- [x] Step 7: Tests + local run scripts + docker-compose
- [x] Step 8: How to run + What to do next

---

## Step 1: Repository Structure

```
prime-tracker/
├── apps/
│   ├── api/                    # NestJS backend
│   │   ├── src/
│   │   │   ├── modules/        # Feature modules
│   │   │   │   ├── auth/       # Google SSO + JWT + MFA
│   │   │   │   ├── users/      # User CRUD + role assignment
│   │   │   │   ├── projects/   # Project CRUD + phases
│   │   │   │   ├── buildings/  # Building CRUD
│   │   │   │   ├── units/      # Unit/Lot CRUD
│   │   │   │   ├── budgets/    # Budget lines
│   │   │   │   ├── actuals/    # Synced from QuickBooks
│   │   │   │   ├── loans/      # Loan tracking
│   │   │   │   ├── leases/     # Lease management
│   │   │   │   ├── milestones/ # Milestone tracking
│   │   │   │   ├── commitments/# Contracts/POs
│   │   │   │   ├── sales/      # Unit sales
│   │   │   │   ├── kpi/        # KPI snapshots
│   │   │   │   ├── quickbooks/ # QB OAuth + sync
│   │   │   │   ├── audit/      # Audit log viewer
│   │   │   │   └── admin/      # Admin operations
│   │   │   ├── common/         # Shared utilities
│   │   │   │   ├── decorators/ # Custom decorators
│   │   │   │   ├── guards/     # Auth + RBAC guards
│   │   │   │   ├── interceptors/# Audit interceptor
│   │   │   │   ├── filters/    # Exception filters
│   │   │   │   ├── pipes/      # Validation pipes
│   │   │   │   ├── utils/      # Helpers
│   │   │   │   └── encryption/ # Field-level AES-256-GCM
│   │   │   ├── config/         # App configuration
│   │   │   └── prisma/         # Prisma client module
│   │   ├── prisma/
│   │   │   ├── schema.prisma
│   │   │   ├── migrations/
│   │   │   └── seed.ts
│   │   ├── test/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── nest-cli.json
│   └── web/                    # React frontend
│       ├── src/
│       │   ├── components/     # UI components by domain
│       │   ├── hooks/          # Custom hooks
│       │   ├── contexts/       # Auth + app context
│       │   ├── lib/            # API client, utils
│       │   ├── pages/          # Route pages
│       │   ├── types/          # TypeScript types
│       │   └── styles/         # Global styles
│       ├── public/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       └── index.html
├── packages/
│   └── shared/                 # Shared types & utils
│       ├── src/
│       │   ├── types/
│       │   ├── utils/
│       │   └── constants/
│       ├── package.json
│       └── tsconfig.json
├── infra/
│   ├── docker/
│   │   └── docker-compose.yml
│   └── scripts/
│       ├── setup.sh
│       └── seed.sh
├── package.json                # Root workspace
├── pnpm-workspace.yaml
├── .env.example
├── .gitignore
├── tsconfig.base.json
└── RUNBOOK.md
```

---

## Frontend Architecture

### Tech Stack
- **React 18** + TypeScript + Vite
- **Chakra UI v2** — component library
- **TanStack Query v5** — server state management + caching
- **Zustand** — client state (auth store)
- **React Router v6** — routing with nested layouts
- **Recharts** — data visualization (bar, pie, line charts)
- **Axios** — API client with interceptors for JWT refresh

### Pages
| Route | Component | Description |
|-------|-----------|-------------|
| `/login` | LoginPage | Google SSO login |
| `/auth/callback` | AuthCallbackPage | OAuth redirect handler |
| `/` | DashboardPage | Executive portfolio overview |
| `/projects` | ProjectsPage | Project cards with filters |
| `/projects/:id` | ProjectDetailPage | Tabbed detail (overview, financials, units, milestones, leases, sales) |
| `/admin` | AdminPage | Users, QuickBooks integration, audit log |

### Key Patterns
- **ProtectedRoute** wrapper enforces auth + optional permission check
- **PermissionGate** component for conditional rendering based on RBAC
- **Token refresh interceptor** — automatically refreshes expired access tokens, queues concurrent requests
- **Persistent auth** — Zustand persist middleware stores JWT in localStorage
- **API proxy** — Vite dev server proxies `/api` to `localhost:3001`

### File Structure
```
apps/web/src/
├── App.tsx                  # Routes + ProtectedRoute wrapper
├── main.tsx                 # React entry (ChakraProvider + QueryClient + Router)
├── theme.ts                 # Chakra UI theme (brand colors, Inter font)
├── components/
│   ├── Layout.tsx           # Sidebar + TopBar + Outlet
│   └── ui.tsx               # StatCard, StatusBadge, PhaseProgress, formatters
├── hooks/
│   └── useApi.ts            # TanStack Query hooks for all endpoints
├── lib/
│   └── api.ts               # Axios instance with JWT interceptor + token refresh
├── pages/
│   ├── LoginPage.tsx        # Google SSO button
│   ├── AuthCallbackPage.tsx # Parse tokens from redirect
│   ├── DashboardPage.tsx    # Portfolio KPIs, charts, alerts, milestones
│   ├── ProjectsPage.tsx     # Project list with cards and filters
│   ├── ProjectDetailPage.tsx# Tabbed: overview, financials, units, milestones, leases, sales
│   └── AdminPage.tsx        # Users, QuickBooks, audit log
└── store/
    └── authStore.ts         # Zustand auth state + permission helpers
```

---

## Testing

### Run Tests
```bash
# Unit tests (API)
cd apps/api
pnpm test

# Watch mode
pnpm test -- --watch

# Coverage
pnpm test -- --coverage
```

### Test Coverage
- **EncryptionService**: encrypt/decrypt round-trip, tamper detection, field-level encrypt/decrypt, unicode, large strings
- **AuthService**: Google user validation, token generation, inactive user rejection
- **ProjectsService**: findAll with filters, findById with relations, dashboard aggregation

---

## How to Run (Quick Start)

### Prerequisites
- Node.js 20+
- pnpm 8+
- Docker & Docker Compose

### 1. Clone and install
```bash
cd prime-tracker
pnpm install
```

### 2. Start infrastructure
```bash
docker compose -f infra/docker/docker-compose.yml up -d
```

### 3. Configure environment
```bash
cp .env.example apps/api/.env
# Edit apps/api/.env with your Google OAuth credentials, DB URL, etc.
```

### 4. Run migrations and seed
```bash
cd apps/api
pnpm prisma migrate dev
pnpm prisma db seed
```

### 5. Start development servers
```bash
# From root:
pnpm dev
```

### 6. Access
- Frontend: http://localhost:5173
- API: http://localhost:3001
- API docs: http://localhost:3001/api/docs (Swagger)

---

## QuickBooks Sandbox Setup

1. Create a QuickBooks Developer account at https://developer.intuit.com
2. Create an app → get Client ID and Client Secret
3. Set redirect URI to `http://localhost:3001/api/quickbooks/callback`
4. Add credentials to `.env`:
   ```
   QB_CLIENT_ID=your_client_id
   QB_CLIENT_SECRET=your_client_secret
   QB_REDIRECT_URI=http://localhost:3001/api/quickbooks/callback
   QB_ENVIRONMENT=sandbox
   ```
5. In the app, go to Admin → Integrations → Connect QuickBooks
6. Complete OAuth flow
7. Run initial sync from Admin → QuickBooks → Sync Now

---

## What to Do Next (Post-MVP Milestones)

### Phase 2: Enhanced Financial
- Draw request workflow with approval chain
- Automated forecast calculations
- Investor portal (read-only dashboards)
- Pro forma vs actual comparison

### Phase 3: Multi-Tenant
- Tenant isolation at DB level (row-level security or schema-per-tenant)
- Tenant onboarding workflow
- Per-tenant QuickBooks connections

### Phase 4: Advanced Integrations
- Procore / construction PM sync
- DocuSign for lease execution
- Bank feed integration
- Automated rent collection tracking

### Phase 5: Analytics & AI
- KPI trend analysis with forecasting
- Anomaly detection on budget variances
- AI-assisted lease negotiation modeling
- Portfolio optimization dashboards
