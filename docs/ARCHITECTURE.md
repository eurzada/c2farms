# Architecture

## Overview

C2 Farms is a monorepo with a Node.js/Express backend and React/Vite frontend. The backend serves a REST API and real-time events via Socket.io. PostgreSQL stores all data, with Prisma as the ORM. The frontend is a single-page app using MUI for layout and ag-Grid for editable data grids.

```
┌─────────────────────────────────────────────────────────┐
│                    Frontend (React)                      │
│  Vite dev server :5173  ──proxy──►  Backend :3001       │
│  Pages → Components → Contexts → API Service (axios)    │
│                         ▲ Socket.io client               │
└─────────────────────────┼───────────────────────────────┘
                          │
┌─────────────────────────┼───────────────────────────────┐
│                    Backend (Express)                      │
│  Routes → Services → Prisma → PostgreSQL                 │
│              ▲                                            │
│         Socket.io (real-time cell edits, AI events)      │
└──────────────────────────────────────────────────────────┘
```

## Fiscal Year

The fiscal year runs **November through October**. FY2026 means Nov 2025 – Oct 2026.

- `fiscalYear.js` provides all conversion utilities
- `generateFiscalMonths('Nov')` → `['Nov','Dec','Jan',...,'Oct']`
- `calendarToFiscal(date)` converts calendar dates to fiscal year + month
- `fiscalToCalendar(year, month)` converts back
- The start month is configurable per assumption (defaults to Nov)

All monthly data is stored and queried by fiscal year + three-letter month abbreviation (e.g., `2026` + `Jan`).

## Data Flow

### Budget Entry (Manual)

```
User edits cell in ag-Grid
  → PATCH /per-unit/:year/:month  (or /accounting/:year/:month)
    → calculationService validates leaf category
    → Updates per-unit data_json
    → Auto-calculates accounting = per_unit × total_acres
    → Recalculates parent category sums
    → Saves both MonthlyData rows
    → Socket.io broadcasts cell-changed to farm:{farmId} room
    → AI event emitter fires ai:data-change to farm-ai:{farmId} room
```

### Actuals Import (CSV)

```
User uploads CSV via CsvImportDialog
  → POST /accounting/import-csv
    → Validates assumptions exist for fiscal year
    → Validates category codes are leaf categories
    → Creates/upserts GlAccount records
    → Creates GlActualDetail records (per GL account, per month)
    → glRollupService aggregates GL → category totals
    → Updates MonthlyData with is_actual=true for imported months
    → Socket.io broadcasts cell-changed (type: full_refresh) + ai:data-change
```

### Budget Freeze

```
POST /assumptions/:year/freeze
  → Copies all MonthlyData rows → MonthlyDataFrozen
  → Sets assumption.is_frozen = true
  → Frozen data is used for variance comparison (budget vs forecast)
  → Socket.io broadcasts ai:data-change (budgetFrozen) to farm-ai room
```

## Two-Layer Reporting

Data exists in two parallel representations, always kept in sync:

| Layer | Type | Unit | Stored In |
|-------|------|------|-----------|
| Per-Unit | `per_unit` | $/acre | `monthly_data.data_json` |
| Accounting | `accounting` | Total $ | `monthly_data.data_json` |

**Conversion**: `accounting_value = per_unit_value × total_acres`

When a user edits either layer, `calculationService` recalculates the other and saves both. Parent category values are the sum of their children.

## Category Hierarchy

Categories are farm-specific (stored in `farm_categories`) and follow a fixed structure:

```
Revenue (REVENUE)
  ├── Canola Revenue      ← dynamic, from crops_json
  ├── Durum Revenue       ← dynamic, from crops_json
  ├── ...
  └── Other Income

Inputs (INPUT)
  ├── Seed
  ├── Fertilizer
  └── Chemical

LPM - Labour Power Machinery (LPM)
  ├── Personnel
  ├── Fuel Oil Grease
  ├── Repairs
  └── Shop

LBF - Land Building Finance (LBF)
  └── Rent & Interest

Insurance (INSURANCE)
  ├── Crop Insurance
  └── Other Insurance

── Computed at query time ──
Total Expense = Inputs + LPM + LBF + Insurance
Profit = Revenue − Total Expense
```

- Categories initialized from `defaultCategoryTemplate.js`
- Crop revenue categories generated dynamically from assumption crops
- Each category has: `code`, `display_name`, `parent_id`, `path`, `level`, `sort_order`, `category_type`
- `categoryService.js` builds the hierarchy with a 5-minute cache

## GL Account Rollup

GL (General Ledger) accounts are mapped to leaf categories. When actuals are imported:

1. `GlActualDetail` stores the raw per-account, per-month amounts
2. `glRollupService.rollupGlActuals()` sums all GL accounts per category per month
3. Results are written to `MonthlyData` (type=`accounting`, `is_actual=true`)
4. Per-unit values are back-calculated from accounting ÷ total_acres

This enables drill-down: the Chart of Accounts page shows YTD totals per GL account, while the main grids show category-level rollups.

## JSONB Data Storage

Rather than one column per category per month, financial data is stored in JSONB columns:

```json
// monthly_data.data_json (type='per_unit', month='Jan', fiscal_year=2026)
{
  "input_seed": 12.50,
  "input_fert": 45.00,
  "input_chem": 18.75,
  "lpm_personnel": 8.00,
  "lpm_fog": 6.25,
  ...
}
```

This design allows the category structure to evolve without schema migrations. New categories simply appear as new keys in the JSON.

### Other JSONB Columns

**`assumptions.crops_json`**:
```json
[
  { "name": "Canola", "acres": 1500, "targetYield": 45, "pricePerUnit": 14.50, "unit": "bu" },
  { "name": "Durum", "acres": 1200, "targetYield": 40, "pricePerUnit": 12.00, "unit": "bu" }
]
```

**`assumptions.bins_json`**:
```json
[
  { "name": "Bin 1", "capacity": 5000, "crop": "Canola" },
  { "name": "Bin 2", "capacity": 3000, "crop": "Durum" }
]
```

## Service Layer

| Service | File | Responsibility |
|---------|------|---------------|
| **calculationService** | `services/calculationService.js` | Per-unit ↔ accounting conversion, parent sum recalculation |
| **categoryService** | `services/categoryService.js` | Category CRUD, hierarchy building, 5-min cache |
| **glRollupService** | `services/glRollupService.js` | GL actual import, category rollup aggregation |
| **exportService** | `services/exportService.js` | Excel (ExcelJS) and PDF (pdfmake) generation |
| **forecastService** | `services/forecastService.js` | Budget vs forecast variance calculation |
| **farmContextService** | `services/farmContextService.js` | AI context aggregation, text summary for LLM prompts |
| **quickbooksService** | `services/quickbooksService.js` | QB OAuth framework (stub — sync not yet implemented) |

## Real-Time Sync (Socket.io)

Socket.io provides live updates when multiple users work on the same farm. Three socket rooms per farm provide event isolation:

| Room | Purpose | Joined via |
|------|---------|------------|
| `farm:{farmId}` | Cell edits, full data refreshes, ticket events | `join-farm` |
| `farm-ai:{farmId}` | AI-relevant data change notifications | `join-farm-ai` |
| `farm-marketing:{farmId}` | Marketing contract/delivery/price events | `join-farm-marketing` |

### Events Catalog

| Event | Room | Trigger | Frontend Listener |
|-------|------|---------|-------------------|
| `cell-changed` | `farm:` | Per-unit/accounting cell edit, CSV import, clear year, acres change | `useRealtime` hook (PerUnitGrid, AccountingGrid) |
| `ticket-created` | `farm:` | Mobile ticket upload | `Tickets.jsx` |
| `marketing:contract:created` | `farm-marketing:` | Contract creation (manual or PDF import) | `useMarketingSocket` hook |
| `marketing:contract:updated` | `farm-marketing:` | Contract edit | `useMarketingSocket` hook |
| `marketing:delivery:created` | `farm-marketing:` | Delivery recorded | `useMarketingSocket` hook |
| `marketing:price:updated` | `farm-marketing:` | Price update | `useMarketingSocket` hook |
| `settlement:approved` | `farm-marketing:` | Settlement approved | `useMarketingSocket` hook |
| `ai:data-change` | `farm-ai:` | Any financial data mutation (import, freeze, cell edit) | AI conversation context |

### Broadcast Helpers

- `broadcastCellChange(io, farmId, data)` — emits `cell-changed` to `farm:{farmId}`. Used by financial routes for cell edits, CSV import (`type: 'full_refresh'`), clear year, and acres changes.
- `broadcastMarketingEvent(io, farmId, event, data)` — emits a named event to `farm-marketing:{farmId}`.
- `emitDataChange(io, farmId, event)` — emits `ai:data-change` to `farm-ai:{farmId}`. Used for AI context awareness.

Socket events are emitted from route handlers via `req.app.get('io')`.

## Authentication & Authorization

See [RBAC.md](RBAC.md) for full details.

- JWT tokens (7-day expiry) in `Authorization: Bearer <token>` header
- `authenticate` middleware validates token and sets `req.userId`
- `requireFarmAccess` checks `UserFarmRole` and sets `req.farmRole`
- `requireRole('admin', 'manager')` gates write endpoints
- Frontend uses `AuthContext` (user/token) and `FarmContext` (selected farm, `canEdit`, `isAdmin`)

## Frontend Architecture

```
App.jsx
  └── AuthProvider (user state, token, login/logout)
      └── FarmProvider (selected farm, role, canEdit/isAdmin)
          └── AppLayout
              ├── Header (farm selector, user menu)
              ├── Sidebar (navigation)
              └── <Page>
                  └── Components (grids, charts, dialogs)
```

- Routes protected by `ProtectedRoute` (auth check) and `AdminRoute` (admin check)
- API calls go through `services/api.js` (axios instance with token interceptor)
- ag-Grid handles editable cells with `onCellValueChanged` callbacks
- Socket.io client listens for broadcast events and triggers data refreshes

## Production Serving

In production, the backend serves the built frontend as static files:

```
backend/src/app.js:
  app.use(express.static('../../frontend/dist'))
  // SPA fallback: non-API routes serve index.html
```

Build with `cd frontend && npm run build`, then start only the backend.
