# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

C2 Farms is a full-stack farm financial management app for western Canadian grain operations. It handles budgeting, forecasting, actuals tracking, and per-acre profitability analysis across a **Nov–Oct fiscal year** (FY2026 = Nov 2025 – Oct 2026).

## Commands

### Setup
```bash
docker compose up -d                    # Start PostgreSQL 16
cd backend && npm install               # Install backend deps
npx prisma db push --schema=src/prisma/schema.prisma  # Sync schema
npm run db:seed                         # Seed demo data
cd ../frontend && npm install           # Install frontend deps
```

### Development
```bash
cd backend && npm run dev               # Backend on :3001 (file watching)
cd frontend && npm run dev              # Vite dev server on :5173 (proxies /api to :3001)
```

### Testing
```bash
cd backend && npm test                  # Vitest (run once)
cd backend && npm run test:watch        # Vitest watch mode
cd backend && npm run test:coverage     # With v8 coverage
```
Tests live alongside source as `*.test.js` files in `backend/src/`.

### Linting
```bash
cd backend && npm run lint              # ESLint on backend src/
cd frontend && npm run lint             # ESLint on frontend src/
```

### Database
```bash
cd backend && npm run db:migrate        # Create Prisma migration
cd backend && npm run db:push           # Push schema without migration
cd backend && npm run db:studio         # Open Prisma Studio GUI
```

### Production Build
```bash
npm run build    # (from root) Installs deps + builds Vite bundle
npm run start    # (from root) db push + starts node server
```

## Architecture

### Stack
- **Frontend**: React 18 + Vite 5, MUI v6, ag-Grid Community v31, Chart.js 4, Socket.io-client
- **Backend**: Node.js 20, Express 4, Prisma 5, Socket.io 4
- **Database**: PostgreSQL 16 (via Docker)
- **Auth**: JWT + bcrypt, three roles (admin/manager/viewer) enforced at API and UI levels

### Two-Layer Reporting (Critical Concept)
All financial data exists in two parallel representations kept bidirectionally in sync:
- **Per-Unit** (`per_unit`): $/acre values
- **Accounting** (`accounting`): Total $ values = per_unit × total_acres

When either layer is edited, `calculationService.js` recalculates the other and saves both. Parent category values = sum of children.

### Key Data Flow Patterns

**Budget entry**: ag-Grid cell edit → PATCH `/api/per-unit/:year/:month` or `/api/accounting/:year/:month` → `calculationService` validates & recalculates → saves `MonthlyData` → Socket.io broadcasts to other clients

**Actuals import**: CSV upload → creates `GlAccount` + `GlActualDetail` records → `glRollupService` aggregates GL → category totals → updates `MonthlyData` with `is_actual=true`

**Budget freeze**: Copies all `MonthlyData` → `MonthlyDataFrozen`, sets `assumption.is_frozen = true`. Used for variance analysis. Admin-only unfreeze.

### Backend Structure
```
backend/src/
├── server.js              # HTTP + Socket.io entry
├── app.js                 # Express app, middleware, route registration
├── config/database.js     # Prisma client singleton
├── middleware/auth.js      # JWT auth + RBAC (requireRole, requireFarmAccess)
├── routes/                # 19+ route files (~54 endpoints)
├── services/              # Business logic (calculation, forecast, GL rollup, exports, QB, inventory, marketing)
├── socket/                # Socket.io handler + AI events
├── prisma/schema.prisma   # 25+ models
├── prisma/seed.js         # Demo data seeder
└── utils/                 # Fiscal year helpers, category constants, crypto
```

### Frontend Structure
```
frontend/src/
├── App.jsx                # Routes with auth guards (ProtectedRoute, AdminRoute, ModuleRoute)
├── pages/                 # Page components (Login, Assumptions, PerUnit, Accounting, Dashboard, inventory/, marketing/)
├── components/            # Shared + layout components
├── contexts/              # AuthContext (user/JWT), FarmContext (farm selection/roles), ThemeContext
├── services/api.js        # Axios client (baseURL /api, JWT interceptor)
├── services/socket.js     # Socket.io client
└── utils/                 # Calculations, formatting, fiscal year, grid colors
```

### Key Services
| Service | Purpose |
|---------|---------|
| `calculationService` | Per-unit ↔ accounting conversions, category rollups |
| `forecastService` | KPI calculations and forecasts |
| `glRollupService` | GL account → category aggregation |
| `exportService` | Excel (ExcelJS) and PDF (pdfmake) generation |
| `quickbooksService` | QuickBooks OAuth + expense sync |
| `inventoryService` | Bin inventory, commodities, contracts |
| `marketingService` | Marketing contracts, pricing, cash flow |

### Category Hierarchy
Farm-specific hierarchical structure: Revenue, Inputs, Labour & Professional Management, Labour & Building Facilities, Insurance. Total Expense and Profit computed at query time.

## Conventions

- Prisma schema lives at `backend/src/prisma/schema.prisma` (non-standard path — always use `--schema` flag)
- Frontend proxies `/api` and `/socket.io` to backend via Vite config
- RBAC is enforced in both `middleware/auth.js` (backend) and route guards in `App.jsx` (frontend)
- Farm context is central — most API endpoints require `farmId` and check farm access
- Fiscal year utilities in both `backend/src/utils/fiscalYear.js` and `frontend/src/utils/fiscalYear.js`
- Dev DB credentials: `postgresql://c2farms:c2farms_dev@localhost:5432/c2farms`
- Seed accounts: `farmer@c2farms.com` / `manager@c2farms.com` / `viewer@c2farms.com` (all `password123`)

## Documentation
Comprehensive docs in `/docs/`: ARCHITECTURE.md, API.md, DATABASE.md, RBAC.md, DEPLOYMENT.md, plus per-module docs in `docs/modules/`.
