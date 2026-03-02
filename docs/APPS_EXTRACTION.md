# Apps Extraction Plan — Monorepo Module Split

## Current State

Everything lives in a single frontend (`frontend/`) with all pages for both
Forecast and Inventory modules. This works fine for now but doesn't match the
target architecture of independent apps per module.

## Target Structure

```
c2farms/
├── apps/
│   ├── forecast/          # Standalone React+Vite app
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   ├── index.html
│   │   └── src/
│   │       ├── pages/     # Assumptions, PerUnit, Accounting, Dashboard, etc.
│   │       └── components/
│   ├── inventory/         # Standalone React+Vite app
│   │   ├── package.json
│   │   ├── vite.config.js
│   │   ├── index.html
│   │   └── src/
│   │       ├── pages/     # InventoryDashboard, BinInventory, Contracts, etc.
│   │       └── components/
│   └── hub/               # Optional: landing page / module picker
├── packages/
│   └── shared/            # Shared npm workspace package
│       ├── package.json
│       └── src/
│           ├── auth/      # AuthContext, useAuth, JWT interceptor
│           ├── farm/      # FarmContext, useFarm
│           ├── theme/     # MUI theme, ThemeContext, dark mode, gridColors
│           ├── api/       # Axios instance (api.js)
│           ├── layout/    # AppLayout, Sidebar shell, ErrorBoundary
│           └── utils/     # fiscalYear, formatting helpers
├── backend/               # UNCHANGED — same Express API
└── package.json           # Root workspace config
```

## Steps

### 1. Set up workspaces (root package.json)
- Add `"workspaces": ["apps/*", "packages/*"]` (npm) or equivalent pnpm config
- Each sub-project gets its own `package.json` with dependencies

### 2. Create `packages/shared` (@c2farms/shared)
Extract from current `frontend/src/`:
- `contexts/AuthContext.jsx` → `packages/shared/src/auth/`
- `contexts/FarmContext.jsx` → `packages/shared/src/farm/`
- `contexts/ThemeContext.jsx` → `packages/shared/src/theme/`
- `services/api.js` → `packages/shared/src/api/`
- `components/layout/AppLayout.jsx` → `packages/shared/src/layout/`
- `components/layout/Sidebar.jsx` → configurable sidebar (each app passes its own nav items)
- `components/shared/ErrorBoundary.jsx` → `packages/shared/src/layout/`
- `utils/fiscalYear.js`, `utils/gridColors.js`, `utils/formatting.js` → `packages/shared/src/utils/`

### 3. Create `apps/forecast`
- New Vite project: `npm create vite@latest apps/forecast -- --template react`
- Move all forecast pages: Assumptions, PerUnit, Accounting, Dashboard, OperationalData, ChartOfAccounts, Settings
- Move forecast components: accounting/, dashboard/, per-unit/, etc.
- Import shared code: `import { useAuth } from '@c2farms/shared/auth'`

### 4. Create `apps/inventory`
- New Vite project
- Move inventory pages: InventoryDashboard, BinInventory, Contracts, Reconciliation, FarmManagerView
- Move inventory components: inventory/
- Import shared code same way

### 5. Update deployment
**Option A — Path-based routing (simplest for Render):**
- Build both apps, serve from different paths
- Backend serves `/forecast/*` → forecast dist, `/inventory/*` → inventory dist
- Nginx or Express static middleware handles routing

**Option B — Subdomain routing:**
- `forecast.c2farms.com` → forecast app
- `inventory.c2farms.com` → inventory app
- Same backend API at `api.c2farms.com` or shared path

### 6. Delete `frontend/`
- Once both apps are extracted and working, remove the monolithic frontend

## What Changes in Each App's Code

Minimal. Page components stay the same. Only imports change:

```jsx
// Before (monolithic)
import { useFarm } from '../../contexts/FarmContext';
import api from '../../services/api';

// After (workspace)
import { useFarm } from '@c2farms/shared/farm';
import { api } from '@c2farms/shared/api';
```

## When to Do This

Not urgent. Do it when:
- Different people need to work on different modules simultaneously
- You want independent deploy cycles (fix inventory without redeploying forecast)
- A third module (Agronomy, AI Analytics) is being added and the single frontend gets unwieldy
