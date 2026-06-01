**# prime-tracker
Internal real estate development dashboard for project tracking, financials, and QuickBooks integration
**# Prime Tracker

Internal real estate development dashboard for project tracking, financials, and QuickBooks integration.

## 🚀 Tech Stack
  
* Backend: NestJS + Prisma + PostgreSQL
* Frontend: React + TypeScript + Chakra UI
* Auth: Google Workspace SSO + MFA
* Queue: Redis + BullMQ

## 📊 Features

* Project lifecycle tracking (pre-dev → sold)
* Budget vs actual vs forecast
* Loan tracking and rent roll
* QuickBooks integration
* Role-based access control (RBAC)
* Audit logging

## 🏗️ Architecture

Monorepo structure with:

* `apps/api` → Backend (NestJS)
* `apps/web` → Frontend (React)
* `packages/shared` → Shared types

## ▶️ Run Locally

```bash
# Run backend
cd apps/api && pnpm run dev

# Run frontend (in a new terminal)
cd apps/web && pnpm run dev

# Alternatively, run both in parallel from the project root:
# pnpm run dev
```

## 📌 Roadmap

* Multi-tenant support
* Investor dashboards
* AI analytics
