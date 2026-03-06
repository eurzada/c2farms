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
├── middleware/
│   ├── auth.js            # JWT auth + RBAC (requireRole, requireFarmAccess)
│   ├── errorHandler.js    # Global error handler (Prisma errors, status codes)
│   └── validation.js      # validateBody(schema) middleware for request body validation
├── routes/                # 29 route files (~80+ endpoints)
├── services/              # Business logic (calculation, forecast, GL rollup, exports, QB, inventory, marketing)
├── socket/                # Socket.io handler + AI events
├── prisma/schema.prisma   # 35+ models
├── prisma/seed.js         # Demo data seeder
└── utils/
    ├── fiscalYear.js      # Nov-Oct fiscal year helpers
    ├── categories.js       # Legacy category hierarchy (FinancialCategory seeding)
    ├── defaultCategoryTemplate.js  # Farm category template
    ├── crypto.js           # AES encryption for QB/FieldOps tokens
    ├── fontPaths.js        # Shared font discovery for PDF generation (pdfmake)
    └── logger.js           # Structured logger factory (JSON in production)
```

### Frontend Structure
```
frontend/src/
├── App.jsx                # Routes with auth guards + React.lazy code splitting
├── pages/                 # Page components (Login, Assumptions, PerUnit, Accounting, Dashboard, inventory/, marketing/, logistics/, agronomy/, enterprise/)
├── components/
│   ├── shared/            # ConfirmDialog, ErrorBoundary, TabPanel
│   ├── layout/            # AppLayout, Header, Sidebar
│   └── (feature)/         # per-unit/, accounting/, marketing/, inventory/, etc.
├── contexts/              # AuthContext (user/JWT), FarmContext (farm selection/roles), ThemeContext
├── hooks/
│   ├── useRealtime.js     # Socket.io cell-changed listener (joins farm room)
│   ├── useMarketingSocket.js  # Marketing event listener
│   └── useConfirmDialog.js    # Promise-based confirm dialog hook
├── services/
│   ├── api.js             # Axios client (baseURL /api, JWT interceptor, 401 handling)
│   └── socket.js          # Socket.io client (getSocket, connectSocket, disconnectSocket)
└── utils/
    ├── formatting.js      # formatCurrency (CAD), formatNumber, fmt, fmtDollar, fmtSigned
    ├── errorHelpers.js    # extractErrorMessage(err, fallback)
    ├── fiscalYear.js      # Nov-Oct fiscal year helpers (mirrors backend)
    ├── gridColors.js      # ag-Grid theme-aware cell colors
    └── validation.js      # Assumptions validation helpers
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

### Shared Utilities (Always Reuse, Never Duplicate)
- **Backend logger**: `import createLogger from '../utils/logger.js'` — use `createLogger('tag')` instead of raw `console.log`
- **Backend font paths**: `import { getFontPaths } from '../utils/fontPaths.js'` — for pdfmake font config
- **Backend validation**: `import { validateBody } from '../middleware/validation.js'` — Zod-like schema middleware
- **Frontend formatting**: `import { formatCurrency, fmt, fmtDollar, fmtSigned } from '../utils/formatting.js'` — CAD currency, never local `const fmt =`
- **Frontend errors**: `import { extractErrorMessage } from '../utils/errorHelpers.js'` — extract user-friendly error from Axios responses
- **Frontend confirm**: `import { useConfirmDialog } from '../hooks/useConfirmDialog.js'` — promise-based MUI confirm, never `window.confirm`
- **Frontend tabs**: `import TabPanel from '../components/shared/TabPanel.jsx'` — reusable tab panel, never inline `{value === index && ...}`

## Documentation
Comprehensive docs in `/docs/`: ARCHITECTURE.md, API.md, DATABASE.md, RBAC.md, DEPLOYMENT.md, plus per-module docs in `docs/modules/`.
