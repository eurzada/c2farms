# C2 Farms — Farm Financial Manager

A full-stack farm financial management application for western Canadian grain operations. Built for farm managers and owners to budget, forecast, track actuals, and analyze per-acre profitability across a Nov–Oct fiscal year.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, MUI v6, ag-Grid Community v31, Chart.js 4 |
| Backend | Node.js 20, Express 4, Prisma 5, Socket.io 4 |
| Database | PostgreSQL 16 (Docker) |
| Auth | JWT (jsonwebtoken + bcrypt) |
| Exports | ExcelJS (Excel), pdfmake (PDF) |
| Testing | Vitest, Supertest |
| Linting | ESLint |

## Prerequisites

- Node.js 20+
- Docker & Docker Compose
- npm

## Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Backend
cd backend
cp .env.example .env   # or use existing .env
npm install
npx prisma db push --schema=src/prisma/schema.prisma
npm run db:seed
npm run dev             # → http://localhost:3001

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev             # → http://localhost:5173
```

## Seed Accounts

| Email | Password | Role |
|-------|----------|------|
| `farmer@c2farms.com` | `password123` | admin |
| `manager@c2farms.com` | `password123` | manager |
| `viewer@c2farms.com` | `password123` | viewer |

Seed farm: **Prairie Fields Farm** (5,000 acres — Canola, Durum, Chickpeas, Lentils)

## Application Modules

| # | Module | Route | Description |
|---|--------|-------|-------------|
| 1 | Yield & Assumptions | `/assumptions` | Fiscal year setup, crops, acres, bins, freeze/unfreeze budget |
| 2 | Cost Forecast | `/cost-forecast` | Monthly accounting grid, CSV import, Excel/PDF export |
| 3 | Per-Unit Analysis | `/per-unit` | $/acre view with frozen budget comparison and variance |
| 4 | Operations | `/operations` | Labour hours, equipment hours, fuel litres tracking |
| 5 | Dashboard | `/dashboard` | KPI cards, gauges, crop yields, budget vs forecast charts |
| — | Chart of Accounts | `/chart-of-accounts` | Category hierarchy, GL account management, YTD tracking |
| — | Settings | `/settings` | User management, invites, role assignment, backup (admin only) |

## Project Structure

```
c2farms/
├── backend/
│   └── src/
│       ├── server.js              # HTTP + Socket.io server
│       ├── app.js                 # Express app, middleware, route registration
│       ├── config/database.js     # Prisma client
│       ├── middleware/
│       │   ├── auth.js            # JWT auth, RBAC (requireRole, requireFarmAccess)
│       │   └── errorHandler.js
│       ├── routes/                # 14 route files (~54 endpoints)
│       ├── services/              # Business logic (calculation, export, GL rollup, etc.)
│       ├── socket/                # Socket.io handlers + AI event emitters
│       ├── prisma/
│       │   ├── schema.prisma      # 15 models
│       │   └── seed.js
│       ├── utils/                 # Fiscal year helpers, category templates
│       └── scripts/               # Data migration scripts
├── frontend/
│   └── src/
│       ├── App.jsx                # Routes + auth guards
│       ├── pages/                 # 7 page components
│       ├── components/            # ~28 components (layout, grids, dialogs, charts)
│       ├── contexts/              # AuthContext, FarmContext
│       └── services/              # API client (axios)
├── docs/                          # Project documentation
│   ├── ARCHITECTURE.md
│   ├── API.md
│   ├── DATABASE.md
│   ├── RBAC.md
│   ├── DEPLOYMENT.md
│   └── SECURITY_CHECKLIST.md
└── docker-compose.yml             # PostgreSQL 16
```

## Key Concepts

- **Fiscal Year**: Nov–Oct (configurable per assumption). FY2026 = Nov 2025 – Oct 2026.
- **Two-Layer Reporting**: Per-unit ($/acre) and Accounting (total $) are bidirectionally linked via total acres.
- **Budget Freeze**: Snapshots current data to `monthly_data_frozen` for variance analysis. Admin-only unfreeze.
- **GL Rollup**: GL account actuals aggregate up to farm categories. Import via CSV or (future) QuickBooks sync.
- **Category Hierarchy**: Revenue → Inputs → LPM → LBF → Insurance. Total Expense and Profit computed at query time.
- **RBAC**: Three roles (admin/manager/viewer) enforced at both API and UI levels.

## NPM Scripts

### Backend (`cd backend`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Start with file watching |
| `npm start` | Production start |
| `npm test` | Run tests (Vitest) |
| `npm run db:push` | Sync Prisma schema to DB |
| `npm run db:seed` | Seed sample data |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run lint` | ESLint |

### Frontend (`cd frontend`)

| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server |
| `npm run build` | Production build |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |

## Documentation

| Document | Description |
|----------|-------------|
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, services, real-time sync |
| [API Reference](docs/API.md) | All endpoints with auth requirements and request/response formats |
| [Database Schema](docs/DATABASE.md) | Models, relationships, JSONB structures |
| [RBAC](docs/RBAC.md) | Roles, permissions, middleware, invite flow |
| [Deployment](docs/DEPLOYMENT.md) | Environment variables, Docker, VPS, managed platforms |
| [Security Checklist](docs/SECURITY_CHECKLIST.md) | Production hardening checklist |

## License

Proprietary — C2 Farms.
