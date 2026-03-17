# Developer Onboarding Guide

Welcome to C2 Farms. This guide gets you from zero to productive.

## 1. Access Checklist

| Resource | URL | What you need |
|----------|-----|---------------|
| GitHub repo | `github.com/eurzada/c2farms` | Collaborator invite (ask owner) |
| Render dashboard | `dashboard.render.com` | Team invite (ask owner) |
| Production app | `c2farms.onrender.com` | Seed login: `farmer@c2farms.com` / `password123` |
| Render PostgreSQL | `dashboard.render.com/d/dpg-d6hkovh5pdvs73djrm60-a` | Via Render dashboard |

## 2. Local Setup (15 minutes)

### Prerequisites
- Node.js 20+
- Docker & Docker Compose
- Git

### Steps

```bash
# Clone
git clone git@github.com:eurzada/c2farms.git
cd c2farms

# Start PostgreSQL
docker compose up -d

# Backend
cd backend
npm install
npx prisma db push --schema=src/prisma/schema.prisma
npm run db:seed        # Seeds 7 farms, 303 bins, contracts, tickets, settlements, etc.
cd ..

# Frontend
cd frontend
npm install
cd ..

# Run everything
npm run dev
# Backend → http://localhost:3001
# Frontend → http://localhost:5173
```

### Verify it works
1. Open http://localhost:5173
2. Login with `farmer@c2farms.com` / `password123`
3. You should see the Enterprise dashboard with 7 business units
4. Click into any BU (e.g., "Lewvan") to see the Forecast module
5. Navigate to Inventory, Marketing, Logistics via the sidebar

### Database connection
```
postgresql://c2farms:c2farms_dev@localhost:5432/c2farms
```
Use Prisma Studio for a GUI: `cd backend && npm run db:studio`

## 3. Architecture Overview

### The 30-second version

Single Express backend serves a REST API + Socket.io. React frontend (Vite) talks to the API. PostgreSQL stores everything. Prisma is the ORM. Claude AI extracts data from settlement PDFs and reconciles them against delivery tickets.

### How the pieces fit together

```
Browser (React + MUI + ag-Grid)
    ↕ REST API + Socket.io
Express Backend (routes → services → Prisma)
    ↕ SQL
PostgreSQL 16
    ↕ Claude API
Anthropic (settlement extraction, AI reconciliation)
```

### Module architecture

The app serves multiple "modules" (business functions) from a single backend and frontend. Each module has:
- **Routes** in `backend/src/routes/` — API endpoints
- **Services** in `backend/src/services/` — business logic (no Express req/res)
- **Pages** in `frontend/src/pages/<module>/` — React page components
- **Components** in `frontend/src/components/<module>/` — reusable UI pieces

Modules share the same database, auth, and Socket.io infrastructure.

### Enterprise vs Business Units

This is the most important concept to understand:

- **Enterprise farm** (`is_enterprise=true`): Holds all enterprise-wide data — inventory, marketing contracts, logistics (tickets/settlements). There is ONE enterprise farm record.
- **BU farms** (Balcarres, Hyas, Lewvan, Stockholm, Provost, Ridgedale, Ogema): Hold per-location forecast/budget data.
- When viewing enterprise mode, `FarmContext` uses the enterprise farm's ID for API calls.
- `resolveInventoryFarm()` middleware redirects any BU farmId to the enterprise farm for inventory/marketing/logistics endpoints.

### Fiscal year

Nov–Oct. FY2026 = Nov 2025 through Oct 2026. Both backend and frontend have `utils/fiscalYear.js` with conversion helpers.

## 4. Key Patterns to Know

### Adding a new API endpoint

```
1. Add route in backend/src/routes/<module>.js
2. Add business logic in backend/src/services/<module>Service.js
3. Register route in backend/src/app.js
4. If enterprise-wide: use resolveInventoryFarm middleware
5. If write operation: add requireRole('admin', 'manager')
```

### Adding a new frontend page

```
1. Create page in frontend/src/pages/<module>/<PageName>.jsx
2. Add lazy import + route in frontend/src/App.jsx
3. Add nav item in the appropriate layout component
4. Use api.get/post from services/api.js for data fetching
5. Use useFarm() context for current farm ID
```

### Two-layer financial data

Financial forecast data exists in two parallel forms:
- **Per-unit** ($/acre) — what the farmer thinks in
- **Accounting** (total $) — what the bookkeeper needs

Edit one, `calculationService` recalculates the other. Both stored in `MonthlyData.data_json` (JSONB).

### Settlement AI pipeline

This is the most complex flow in the app:

```
Upload PDF
  → Claude Vision extracts structured JSON (buyer-specific prompts)
  → User reviews/edits extraction in preview dialog
  → Save creates Settlement + SettlementLine records
  → AI Reconciliation matches lines to DeliveryTicket records
  → Admin approves → creates Delivery records, updates MarketingContract.delivered_mt
```

Each buyer (Cargill, LDC, G3, Bunge, etc.) has a custom extraction prompt in `settlementService.js`.

### Socket.io real-time

Three room types per farm:
- `farm:{id}` — cell edits, ticket events
- `farm-marketing:{id}` — contract/delivery/price events
- `farm-ai:{id}` — AI context notifications

Frontend hooks: `useRealtime.js`, `useMarketingSocket.js`

## 5. Codebase Orientation

### Start here (most important files)

| File | Why |
|------|-----|
| `CLAUDE.md` | Project conventions, shared utilities, architecture reference |
| `backend/src/app.js` | All route registrations — see what endpoints exist |
| `backend/src/prisma/schema.prisma` | All 56 models — the source of truth for data |
| `frontend/src/App.jsx` | All frontend routes — see what pages exist |
| `frontend/src/contexts/FarmContext.jsx` | Enterprise vs BU logic, role checks |
| `backend/src/services/settlementService.js` | AI extraction pipeline (most complex service) |
| `backend/src/services/calculationService.js` | Two-layer financial sync logic |

### Shared utilities (always reuse, never duplicate)

| Utility | Import |
|---------|--------|
| Backend logger | `import createLogger from '../utils/logger.js'` |
| Backend validation | `import { validateBody } from '../middleware/validation.js'` |
| Frontend currency formatting | `import { formatCurrency, fmt, fmtDollar } from '../utils/formatting.js'` |
| Frontend error extraction | `import { extractErrorMessage } from '../utils/errorHelpers.js'` |
| Frontend confirm dialog | `import { useConfirmDialog } from '../hooks/useConfirmDialog.js'` |
| Frontend tab panel | `import TabPanel from '../components/shared/TabPanel.jsx'` |

## 6. Development Workflow

### Making changes

| What you change | What happens |
|-----------------|--------------|
| Backend JS files | Node `--watch` auto-restarts server |
| Frontend JS/JSX files | Vite HMR hot-reloads in browser |
| Prisma schema | Run `cd backend && npx prisma db push --schema=src/prisma/schema.prisma` |

### Testing

```bash
cd backend && npm test            # Run all tests
cd backend && npm run test:watch  # Watch mode
```

Tests are `*.test.js` files alongside source in `backend/src/`.

### Linting

```bash
cd backend && npm run lint
cd frontend && npm run lint
```

### Database exploration

```bash
cd backend && npm run db:studio   # Opens Prisma Studio at localhost:5555
```

Or connect directly: `psql postgresql://c2farms:c2farms_dev@localhost:5432/c2farms`

## 7. Deployment

### How it works

- Push to `main` → Render auto-deploys
- Build: `npm run build` (installs deps, builds Vite, generates Prisma)
- Start: `npm run start` (runs `node backend/src/server.js`)
- The backend serves the built frontend as static files in production
- Database schema syncs via `prisma db push` in the start script

### Render resources

| Resource | ID |
|----------|----|
| Web service | `srv-d6hkp8p5pdvs73djrosg` |
| PostgreSQL | `dpg-d6hkovh5pdvs73djrm60-a` |
| Region | Oregon |
| URL | `c2farms.onrender.com` |

### Manual deploy

```bash
git push origin main              # Auto-deploys, OR:
render deploys create srv-d6hkp8p5pdvs73djrosg  # Manual trigger
```

### Database sync (local → production)

```bash
# Dump local
PGPASSWORD=c2farms_dev pg_dump -h localhost -U c2farms -d c2farms \
  --clean --if-exists --no-owner --no-acl -F c -f /tmp/c2farms_dump.backup

# Restore to Render (get password from Render dashboard or API)
PGPASSWORD=<render_password> pg_restore \
  -h dpg-d6hkovh5pdvs73djrm60-a.oregon-postgres.render.com \
  -p 5432 -U c2farms -d c2farms \
  --clean --if-exists --no-owner --no-acl /tmp/c2farms_dump.backup
```

## 8. What's In Progress / Roadmap

| Item | Status | Notes |
|------|--------|-------|
| LGX Terminal Operations | Phase 1 built | Blending, rail cars, contracts |
| LGX Tonnage Reconciliation | Planned | Contract-level aggregate matching (no ticket-by-ticket) |
| Traction Ag Replacement | Planned (parked) | Auto-contract matching on CSV import, C2 ticket numbering |
| Agronomy Phase 2 | Planned | ag-Grid editable inputs, reports |
| QuickBooks Integration | Stubbed | OAuth routes exist, sync not implemented |
| Consolidated Enterprise View | Partial | Executive rollup across all BUs |

See `docs/modules/` for detailed specs on each module.

## 9. Getting Help

- **Project docs**: `docs/` directory (architecture, API, database, RBAC, deployment)
- **Module docs**: `docs/modules/` (agronomy, LGX terminal, reconciliation)
- **AI assistant**: This project uses Claude Code with instructions in `CLAUDE.md`
- **Code conventions**: All in `CLAUDE.md` — read this before making changes
