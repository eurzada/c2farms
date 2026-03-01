# C2 Farms ERP — Modular Architecture

## Overview

C2 Farms is a modular ERP for western Canadian grain operations. Each functional module (Forecast, Inventory, Agronomy, etc.) is a **standalone frontend app** with its own UI, navigation, and persona focus — but all modules share a **single backend and database**.

This gives each user (farm manager, control manager, agronomist) a focused experience while keeping data connected across the platform.

## Repo Structure

```
c2farms/
├── backend/                  ← ONE shared backend (all modules)
│   ├── src/
│   │   ├── routes/
│   │   │   ├── auth.js           ← shared auth (login, register, invite)
│   │   │   ├── farms.js          ← shared farm CRUD
│   │   │   ├── forecast/         ← forecast module routes
│   │   │   ├── inventory/        ← inventory module routes
│   │   │   └── <module>/         ← future modules follow same pattern
│   │   ├── services/             ← business logic per module
│   │   ├── middleware/           ← shared auth, RBAC, error handling
│   │   ├── prisma/
│   │   │   └── schema.prisma     ← ONE schema for all modules
│   │   └── utils/                ← shared utilities
│   └── package.json
│
├── apps/
│   ├── forecast/             ← Financial Forecast frontend (farm manager)
│   │   ├── src/
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── package.json
│   ├── inventory/            ← Inventory Management frontend (control manager)
│   │   ├── src/
│   │   ├── index.html
│   │   ├── vite.config.js
│   │   └── package.json
│   └── <module>/             ← future modules follow same pattern
│
├── packages/
│   └── shared/               ← shared code across frontends
│       ├── auth/             ← useAuth hook, AuthContext, login/register
│       ├── api/              ← API client, interceptors
│       ├── components/       ← common UI (layouts, dialogs, notifications)
│       └── package.json
│
├── render.yaml               ← deployment blueprint
├── package.json              ← workspace root (npm workspaces)
└── docs/
```

## Principles

### 1. One Backend, One Database
All modules share a single Express API and PostgreSQL database. This means:
- No API-to-API integration between modules — data is joined at the database level
- One Prisma schema defines all tables — cross-module relationships are native foreign keys
- Shared auth — one JWT works across all frontends
- One backend deployment on Render

### 2. Separate Frontend Apps
Each module is a standalone React + Vite app with:
- Its own URL (e.g., `forecast.c2farms.com`, `inventory.c2farms.com`)
- Its own navigation, pages, and UI tailored to its persona
- Its own `package.json` and build
- No knowledge of other frontends — they communicate only through shared backend data

### 3. Shared Packages
Common code lives in `packages/shared/` and is consumed by all frontend apps:
- Auth hooks and context (login, JWT management, role checks)
- API client with base URL config and token interceptors
- Common UI components (app shell, sidebar layout, notification toasts)

### 4. Persona-Based Access
Each module targets a specific user persona:
| Module | Primary Persona | Description |
|--------|----------------|-------------|
| Forecast | Farm Manager / Owner | Budgeting, actuals, P&L, KPIs |
| Inventory | Control Manager | Bin counts, grain movement, storage |
| Agronomy | Agronomist | Field plans, seed/chem/fert records |
| (future) | ... | ... |

Users log in once. RBAC determines which modules and data they can access.

### 5. Module Independence
Each module can be:
- Developed independently (own feature branches if needed)
- Deployed independently (separate Render static sites)
- Used without the others (control manager never sees forecast UI)

But modules share data naturally through the common database. For example:
- Inventory grain totals feed into forecast revenue calculations
- Forecast crop assumptions provide commodity lists for inventory
- Agronomy field data could feed into per-acre cost analysis

## Adding a New Module

When building a new module (e.g., Agronomy), follow this pattern:

### Backend
1. Add models to `backend/src/prisma/schema.prisma`
2. Create routes in `backend/src/routes/<module>/`
3. Create services in `backend/src/services/<module>/`
4. Register routes in `server.js`
5. Run `prisma db push` to update the database

### Frontend
1. Create `apps/<module>/` with its own Vite + React setup
2. Import shared auth/API from `packages/shared/`
3. Build module-specific pages, components, and navigation
4. Add a Render static site service to `render.yaml`

### Documentation
1. Add module doc to `docs/modules/<Module Name>.md`
2. Update this architecture doc if new cross-module patterns emerge

## Deployment (Render)

| Service | Type | What |
|---------|------|------|
| `c2farms-api` | Web Service | Shared Node.js backend |
| `c2farms-db` | PostgreSQL | Shared database |
| `c2farms-forecast` | Static Site | Forecast frontend |
| `c2farms-inventory` | Static Site | Inventory frontend |
| `c2farms-<module>` | Static Site | Future module frontends |

All static sites point their API calls to the single backend service.

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend (per app) | React 18, Vite, MUI v6, ag-Grid Community v31, Chart.js 4 |
| Backend (shared) | Node.js 20, Express 4, Prisma 5, Socket.io 4 |
| Database (shared) | PostgreSQL 16 |
| Auth (shared) | JWT (jsonwebtoken + bcrypt) |
| Exports | ExcelJS (Excel), pdfmake (PDF) |

## Current Module Status

| Module | Status | Frontend Location |
|--------|--------|-------------------|
| Financial Forecast | Complete | `apps/forecast/` (currently `frontend/`) |
| Inventory | Next up | `apps/inventory/` |
| AI Analytics | Partial (keyword-based, needs LLM) | Embedded in forecast |
| QuickBooks Integration | Partial (routes stubbed) | Embedded in forecast |
| Agronomy | Not started | `apps/agronomy/` (future) |
