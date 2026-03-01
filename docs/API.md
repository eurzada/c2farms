# API Reference

Base URL: `http://localhost:3001/api`

All endpoints return JSON. Authentication is via `Authorization: Bearer <token>` header unless noted otherwise.

**Common error responses**:
- `401 { error: "No token provided" }` — missing or invalid JWT
- `403 { error: "Access denied: no access to this farm" }` — user lacks farm access
- `403 { error: "Insufficient permissions" }` — role check failed

---

## Auth

### POST `/auth/register`
Create a new account. No auth required.

**Rate limit**: 3 requests/hour per IP.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | yes | Must be valid email format |
| `password` | string | yes | Min 8 chars, at least one letter and one number |
| `name` | string | yes | |

**Response**: `{ token, user: { id, email, name, role } }`

Auto-accepts any pending `FarmInvite` matching the email.

### POST `/auth/login`
**Rate limit**: 5 requests/15 min per IP.

| Field | Type | Required |
|-------|------|----------|
| `email` | string | yes |
| `password` | string | yes |

**Response**: `{ token, user: { id, email, name, role } }`

### GET `/auth/me`
Get current user profile and accessible farms. Requires auth.

**Response**: `{ user: { id, email, name, role }, farms: [{ id, name, role, created_at }] }`

---

## Farms

### POST `/farms`
Create a new farm. Caller becomes admin.

| Field | Type | Required |
|-------|------|----------|
| `name` | string | yes |

**Response**: `{ id, name, role: "admin", ... }`

### PATCH `/farms/:farmId`
Rename a farm. **Admin only**.

| Field | Type | Required |
|-------|------|----------|
| `name` | string | yes |

### DELETE `/farms/:farmId`
Delete farm and all related data. **Admin only**. Irreversible.

---

## Assumptions

All routes: `/farms/:farmId/assumptions`

### GET `/assumptions/:year`
Get assumptions for a fiscal year.

**Response**: `{ id, farm_id, fiscal_year, total_acres, crops_json, bins_json, is_frozen, frozen_at, start_month, end_month }`

### POST `/assumptions`
Create or update assumptions. **Admin/Manager**.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `fiscal_year` | int | yes | 2000–2100 |
| `total_acres` | float | yes | |
| `crops` | array | yes | `[{ name, acres, targetYield, pricePerUnit, unit }]` |
| `bins` | array | no | `[{ name, capacity, crop }]` |
| `start_month` | string | no | Default: "Nov" |

Creates 12×2 MonthlyData rows (per_unit + accounting) if they don't exist. Recalculates accounting from per-unit if acres changed.

### POST `/assumptions/:year/freeze`
Freeze the budget. **Admin/Manager**. Copies MonthlyData → MonthlyDataFrozen.

### POST `/assumptions/:year/unfreeze`
Unfreeze the budget. **Admin only**. Keeps frozen snapshot for comparison.

---

## Financial

All routes: `/farms/:farmId`

### GET `/categories`
Get all farm categories (expense-focused tree).

### GET `/per-unit/:year`
Get per-unit ($/acre) data for all 12 months.

**Response**:
```json
{
  "fiscalYear": 2026,
  "startMonth": "Nov",
  "months": ["Nov", "Dec", ..., "Oct"],
  "rows": [{
    "code": "input_seed",
    "display_name": "Seed",
    "level": 1,
    "parent_code": "inputs",
    "months": { "Nov": 0, "Dec": 12.5, ... },
    "actuals": { "Nov": false, "Dec": true, ... },
    "comments": {},
    "forecastTotal": 150.00,
    "frozenBudgetTotal": 145.00,
    "variance": 5.00,
    "pctDiff": 3.45
  }],
  "isFrozen": true
}
```

Includes computed `total_expense` row. Excludes revenue categories.

### PATCH `/per-unit/:year/:month`
Edit a per-unit cell. **Admin/Manager**. Blocked if month is locked (`is_actual=true`).

| Field | Type | Required |
|-------|------|----------|
| `category_code` | string | yes |
| `value` | float | yes |
| `comment` | string | no |

**Response**: `{ perUnit: {...}, accounting: {...} }` — both updated data sets.

### GET `/accounting/:year`
Get accounting (total $) data for all 12 months. Same structure as per-unit but with dollar totals and a `summary` object with monthly total expenses.

### PATCH `/accounting/:year/:month`
Edit an accounting cell. **Admin/Manager**. Auto-recalculates per-unit.

| Field | Type | Required |
|-------|------|----------|
| `category_code` | string | yes |
| `value` | float | yes |

### POST `/financial/manual-actual`
Manually enter actual data (QB fallback). **Admin/Manager**.

| Field | Type | Required |
|-------|------|----------|
| `fiscal_year` | int | yes |
| `month` | string | yes |
| `data` | object | yes | `{ category_code: value }` |

### GET `/prior-year/:year`
Get prior year per-unit aggregate (all 12 months summed).

---

## Forecast

### GET `/farms/:farmId/forecast/:year`
Get forecast with budget comparison.

**Response**: `{ revenue: { forecastTotal, frozenBudgetTotal, variance }, inputs: {...}, lpm: {...}, lbf: {...}, insurance: {...} }`

---

## Dashboard

### GET `/farms/:farmId/dashboard/:year`
Get KPIs, chart data, and crop yields.

**Response**:
```json
{
  "kpis": [
    { "label": "Yield vs Target", "value": 92, "unit": "%", "gauge": true, "target": 100 },
    { "label": "Expense / Acre", "value": 285.50, "unit": "$" }
  ],
  "chartData": {
    "labels": ["Inputs", "LPM", "LBF", "Insurance"],
    "budget": [150, 80, 45, 20],
    "forecast": [155, 78, 45, 22]
  },
  "cropYields": [
    { "name": "Canola", "acres": 1500, "targetYield": 45, "actualYield": 42, "yieldPct": 93 }
  ]
}
```

---

## Operational Data

### GET `/farms/:farmId/operational-data/:year`
Get operational metrics grouped by metric name.

**Response**: `{ labour_hours: { Nov: { budget_value, actual_value }, ... }, equipment_hours: {...}, fuel_litres: {...} }`

### PUT `/farms/:farmId/operational-data/:year`
Batch upsert operational data. **Admin/Manager**.

**Body**: `[{ metric, month, budget_value, actual_value }]`

---

## Chart of Accounts

All routes: `/farms/:farmId`

### GET `/chart-of-accounts`
Get categories and GL accounts. Optional `?fiscal_year=2026` for YTD totals.

### POST `/chart-of-accounts/init`
Initialize categories from template. **Admin/Manager**.

| Field | Type | Required |
|-------|------|----------|
| `crops` | array | no | Uses latest assumption crops if omitted |

### POST `/categories`
Create a category. **Admin/Manager**.

| Field | Type | Required |
|-------|------|----------|
| `code` | string | yes |
| `display_name` | string | yes |
| `parent_code` | string | no |
| `category_type` | string | yes |
| `sort_order` | int | no |

### PUT `/categories/:id`
Update a category. **Admin/Manager**.

### DELETE `/categories/:id`
Soft-delete (deactivate) a category. **Admin/Manager**.

### GET `/gl-accounts`
List all active GL accounts.

### POST `/gl-accounts`
Bulk create GL accounts. **Admin/Manager**.

**Body**: `{ accounts: [{ account_number, account_name, category_code, qb_account_id }] }`

### PUT `/gl-accounts/:id`
Update a GL account. **Admin/Manager**.

### POST `/gl-accounts/bulk-assign`
Bulk assign GL accounts to categories. **Admin/Manager**. Optionally re-rollup.

**Body**: `{ assignments: [{ account_number, category_code }], fiscal_year }`

### POST `/gl-actuals/import`
Import GL actuals (from QBO export). **Admin/Manager**.

**Body**:
```json
{
  "fiscal_year": 2026,
  "rows": [{ "account_number": "9660", "month": "Jan", "amount": 15000 }],
  "new_accounts": [{ "account_number": "9999", "account_name": "New Account", "category_code": "lpm_shop" }]
}
```

---

## CSV Import

### POST `/farms/:farmId/accounting/import-csv`
Import accounting data from CSV. **Admin/Manager**.

**Body**:
```json
{
  "fiscal_year": 2026,
  "accounts": [{
    "name": "Seed",
    "category_code": "input_seed",
    "months": { "Nov": 0, "Dec": 1500, "Jan": 3000 }
  }]
}
```

### DELETE `/farms/:farmId/accounting/clear-year`
Clear all GL actuals and reset monthly data for a year. **Admin/Manager**.

**Body**: `{ fiscal_year: 2026 }`

---

## Exports

### POST `/farms/:farmId/export/excel/:year`
Download operating statement as `.xlsx`.

### POST `/farms/:farmId/export/pdf/:year`
Download operating statement as `.pdf`.

---

## Settings

All routes: `/farms/:farmId/settings` — **Admin only**.

### GET `/users`
List farm users and pending invites.

### POST `/users/invite`
Invite a user by email.

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `email` | string | yes | |
| `role` | string | no | Default: "viewer" |

If the email belongs to an existing user, a `UserFarmRole` is created immediately. Otherwise, a `FarmInvite` is created (30-day expiry, auto-accepted on registration/login).

### PATCH `/users/:userId`
Change a user's role. Prevents removing the last admin.

| Field | Type | Required |
|-------|------|----------|
| `role` | string | yes | `admin`, `manager`, or `viewer` |

### DELETE `/users/:userId`
Remove user from farm. Prevents removing the last admin.

### DELETE `/invites/:inviteId`
Cancel a pending invite.

### POST `/backup`
Export all farm data as JSON.

---

## AI

All routes: `/farms/:farmId/ai`

### GET `/context/:year`
Get structured farm context for LLM consumption. Optional `?gl_detail=true` for GL-level detail.

### GET `/context/:year/summary`
Get plain-text summary of farm context for LLM prompts.

### POST `/query`
Natural language query with keyword-based intent detection.

| Field | Type | Required |
|-------|------|----------|
| `query` | string | yes |
| `fiscal_year` | int | no |
| `conversation_id` | string | no |

**Response**: `{ intent, response, data, conversation_id }`

Intents: `profit`, `forecast`, `crops`, `budget`, `expenses`, `general`

### GET `/conversations`
List user's AI conversations (last 50).

### GET `/conversations/:id`
Get full conversation with messages.

---

## QuickBooks

### GET `/quickbooks/auth-url`
Get OAuth2 authorization URL. Requires auth + `?farmId=xxx`.

### GET `/quickbooks/callback`
OAuth2 callback. Redirects to frontend.

### POST `/farms/:farmId/quickbooks/sync`
Sync QB expenses. **Admin/Manager**. (Stub — not yet implemented.)

### GET `/farms/:farmId/quickbooks/mappings`
Get QB → category mappings.

### POST `/farms/:farmId/quickbooks/mappings`
Create/update a QB mapping. **Admin/Manager**.

---

## Health

### GET `/health`
Health check. No auth.

**Response**: `{ status: "ok", timestamp: "..." }`
