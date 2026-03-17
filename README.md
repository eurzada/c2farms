# C2 Farms — Modular Farm ERP

A full-stack modular ERP for western Canadian grain operations. Manages financial forecasting, grain inventory, marketing contracts, logistics (ticket/settlement reconciliation), agronomy planning, and terminal operations across 7 business units and ~40,000 acres.

**Live**: [c2farms.onrender.com](https://c2farms.onrender.com)

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, MUI v6, ag-Grid Community v31, Chart.js 4 |
| Backend | Node.js 20, Express 4, Prisma 5, Socket.io 4 |
| Database | PostgreSQL 16 (Docker locally, Render managed in prod) |
| AI | Anthropic Claude API (settlement PDF extraction, AI reconciliation) |
| Auth | JWT (jsonwebtoken + bcrypt), 3 roles (admin/manager/viewer) |
| Exports | ExcelJS (Excel), pdfmake (PDF) |
| Real-time | Socket.io (cell edits, ticket events, marketing updates) |
| Testing | Vitest, Supertest |
| Hosting | Render (web service + PostgreSQL) |

## Quick Start

```bash
# 1. Start PostgreSQL
docker compose up -d

# 2. Backend
cd backend
npm install
npx prisma db push --schema=src/prisma/schema.prisma
npm run db:seed
npm run dev             # → http://localhost:3001

# 3. Frontend (new terminal)
cd frontend
npm install
npm run dev             # → http://localhost:5173

# Or run both at once from root:
npm run dev
```

## Seed Accounts

| Email | Password | Role |
|-------|----------|------|
| `farmer@c2farms.com` | `password123` | admin |
| `manager@c2farms.com` | `password123` | manager |
| `viewer@c2farms.com` | `password123` | viewer |

## Application Modules

| # | Module | Status | Description |
|---|--------|--------|-------------|
| 1 | **Financial Forecast** | Complete | Budget, actuals, per-unit/accounting grids, GL rollup, freeze/variance |
| 2 | **Grain Inventory** | Complete | 303 bins across 8 locations, FM counts, dashboard, grading |
| 3 | **Grain Marketing** | Complete | Contracts, pricing, cash flow, sell decision tool, buyers |
| 4 | **Grain Logistics** | Complete | Ticket import (CSV), settlement extraction (Claude Vision), AI reconciliation |
| 5 | **Agronomy** | Phase 1 | Crop plans, nutrient balance, input costing |
| 6 | **LGX Terminal** | Phase 1 | Blending/transloading operations, rail car management |
| 7 | **Enterprise View** | Partial | Cross-BU rollup dashboards |

## Codebase Stats

- **240 source files** (~22,500 lines of JS/JSX)
- **56 database models** (1,200-line Prisma schema)
- **35 route files** (~100+ API endpoints)
- **48 service files** (business logic)
- **42 frontend pages** across 7 module directories

## Project Structure

```
c2farms/
├── backend/src/
│   ├── server.js              # HTTP + Socket.io entry
│   ├── app.js                 # Express app, middleware, route registration
│   ├── config/database.js     # Prisma client singleton
│   ├── middleware/             # auth.js (JWT + RBAC), errorHandler.js, validation.js
│   ├── routes/                # 35 route files
│   ├── services/              # 48 service files (calculation, inventory, marketing, etc.)
│   ├── socket/                # Socket.io handler + AI events
│   ├── prisma/schema.prisma   # 56 models
│   ├── prisma/seed.js         # Demo data seeder
│   ├── scripts/               # Data migration & seed scripts
│   └── utils/                 # Fiscal year, categories, crypto, logger, fonts
├── frontend/src/
│   ├── App.jsx                # Routes + auth guards + code splitting
│   ├── pages/                 # 42 page components across module dirs
│   ├── components/            # Feature components (per-unit, accounting, marketing, etc.)
│   ├── contexts/              # AuthContext, FarmContext, ThemeContext
│   ├── hooks/                 # useRealtime, useMarketingSocket, useConfirmDialog
│   ├── services/              # api.js (axios), socket.js (Socket.io client)
│   └── utils/                 # formatting, fiscalYear, gridColors, validation
├── apps/mobile/               # React Native trucker app (Expo)
├── docs/                      # Architecture, API, DB schema, RBAC, deployment docs
├── CLAUDE.md                  # AI assistant instructions
├── render.yaml                # Render deployment blueprint
└── docker-compose.yml         # PostgreSQL 16
```

## Key Concepts

- **Fiscal Year**: Nov–Oct. FY2026 = Nov 2025 – Oct 2026.
- **Enterprise vs BU**: Enterprise farm (`is_enterprise=true`) holds all enterprise-wide data (inventory, marketing, logistics). 7 BU farms hold per-location forecast data.
- **Two-Layer Reporting**: Per-unit ($/acre) and Accounting (total $) kept in bidirectional sync via `calculationService`.
- **Settlement AI Pipeline**: Upload PDF → Claude Vision extracts structured data → review/edit → save → AI reconciliation matches to delivery tickets → approve.
- **RBAC**: Three roles (admin/manager/viewer) enforced at both API middleware and frontend route guards.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | JWT signing secret |
| `ANTHROPIC_API_KEY` | For AI | Claude API key for settlement extraction |
| `NODE_ENV` | Prod | `production` for production mode |
| `CORS_ORIGIN` | Prod | Allowed CORS origin(s) |
| `PORT` | No | Backend port (default: 3001, Render uses 10000) |

## NPM Scripts

### Root
| Script | Description |
|--------|-------------|
| `npm run dev` | Start backend + frontend concurrently |
| `npm run build` | Install deps + build Vite bundle + generate Prisma |
| `npm run start` | Start production server |

### Backend (`cd backend`)
| Script | Description |
|--------|-------------|
| `npm run dev` | Start with `--watch` |
| `npm test` | Run Vitest |
| `npm run db:push` | Sync Prisma schema to DB |
| `npm run db:seed` | Seed demo data |
| `npm run db:studio` | Open Prisma Studio GUI |
| `npm run lint` | ESLint |

### Frontend (`cd frontend`)
| Script | Description |
|--------|-------------|
| `npm run dev` | Vite dev server (proxies /api → :3001) |
| `npm run build` | Production build |
| `npm run lint` | ESLint |

## Documentation

| Document | Description |
|----------|-------------|
| [CLAUDE.md](CLAUDE.md) | AI assistant instructions & project conventions |
| [Onboarding](docs/ONBOARDING.md) | New developer setup & orientation guide |
| [Architecture](docs/ARCHITECTURE.md) | System design, data flow, services, real-time sync |
| [API Reference](docs/API.md) | Endpoints with auth requirements |
| [Database Schema](docs/DATABASE.md) | Models, relationships, JSONB structures |
| [RBAC](docs/RBAC.md) | Roles, permissions, middleware, invite flow |
| [Deployment](docs/DEPLOYMENT.md) | Render, Docker, environment setup |
| [ERP Architecture](docs/ERP_ARCHITECTURE.md) | Multi-module ERP design decisions |
| [Dev Process](docs/DEV_PROCESS.md) | How changes take effect, file watching |

### Module Docs (`docs/modules/`)
Agronomy, LGX Terminal Operations, LGX Reconciliation, LGX Accounting, Enterprise View, and more.

## License

Proprietary — C2 Farms.
