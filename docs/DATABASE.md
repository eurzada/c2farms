# Database Schema

PostgreSQL 16 via Docker. ORM: Prisma 5. Schema file: `backend/src/prisma/schema.prisma`.

Schema sync uses `prisma db push` (no migrations directory).

## Connection

```
postgresql://c2farms:c2farms_dev@localhost:5432/c2farms
```

## Entity Relationship Overview

```
User ──< UserFarmRole >── Farm
                            │
          ┌─────────────────┼─────────────────────────┐
          │                 │                          │
     Assumption        MonthlyData              FarmCategory
                       MonthlyDataFrozen            │
                                               GlAccount
                                                    │
                                              GlActualDetail

Farm ──< FarmInvite
Farm ──< OperationalData
Farm ──< AiConversation ──< AiMessage
Farm ──< QbToken
Farm ──< QbCategoryMapping
```

## Models

### User
Table: `users`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| email | String | Unique |
| password_hash | String | bcrypt hash |
| name | String | |
| role | String | Default: `"farm_manager"` (legacy, RBAC uses UserFarmRole) |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

### Farm
Table: `farms`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| name | String | |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

### UserFarmRole
Table: `user_farm_roles`

Links users to farms with a role. This is the source of truth for RBAC.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| user_id | UUID | FK → users. Cascade delete |
| farm_id | UUID | FK → farms. Cascade delete |
| role | String | `admin`, `manager`, or `viewer` |
| modules | Json | Enabled modules, default: `["forecast","inventory","marketing","logistics"]` |

**Unique**: `(user_id, farm_id)`

### Assumption
Table: `assumptions`

One per farm per fiscal year. Stores crop plans, bins, and freeze state.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| fiscal_year | Int | e.g., 2026 |
| start_month | String | Default: `"Nov"` |
| end_month | String | Default: `"Oct"` |
| total_acres | Float | |
| crops_json | JSONB | See structure below |
| bins_json | JSONB | See structure below |
| is_frozen | Boolean | Default: false |
| frozen_at | DateTime? | When budget was frozen |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

**Unique**: `(farm_id, fiscal_year)`

**`crops_json` structure**:
```json
[
  {
    "name": "Canola",
    "acres": 1500,
    "targetYield": 45,
    "pricePerUnit": 14.50,
    "unit": "bu"
  }
]
```

**`bins_json` structure**:
```json
[
  {
    "name": "Bin 1",
    "capacity": 5000,
    "crop": "Canola"
  }
]
```

### MonthlyData
Table: `monthly_data`

Stores both per-unit and accounting data for each month of a fiscal year.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| fiscal_year | Int | |
| month | String | Three-letter abbreviation: `"Nov"`, `"Dec"`, etc. |
| type | String | `"per_unit"` or `"accounting"` |
| data_json | JSONB | Category code → value map |
| is_actual | Boolean | True if data came from GL import |
| comments_json | JSONB | Category code → comment string |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

**Unique**: `(farm_id, fiscal_year, month, type)`
**Index**: `(farm_id, fiscal_year)`

**`data_json` structure**:
```json
{
  "input_seed": 12.50,
  "input_fert": 45.00,
  "input_chem": 18.75,
  "lpm_personnel": 8.00,
  "inputs": 76.25
}
```

Keys are category codes. Parent values are the sum of their children.

### MonthlyDataFrozen
Table: `monthly_data_frozen`

Snapshot of MonthlyData at freeze time. Same structure, no `updated_at`.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| fiscal_year | Int | |
| month | String | |
| type | String | `"per_unit"` or `"accounting"` |
| data_json | JSONB | |
| is_actual | Boolean | |
| comments_json | JSONB | |
| created_at | DateTime | When frozen |

**Unique**: `(farm_id, fiscal_year, month, type)`
**Index**: `(farm_id, fiscal_year)`

### FarmCategory
Table: `farm_categories`

Per-farm reporting categories. Hierarchical (parent/child).

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| code | String | e.g., `"input_seed"`, `"lpm_fog"` |
| display_name | String | e.g., `"Seed"`, `"Fuel Oil Grease"` |
| parent_id | UUID? | FK → farm_categories (self-referential) |
| path | String | Materialized path: `"inputs.input_seed"` |
| level | Int | 0 = root, 1 = child |
| sort_order | Int | Display ordering |
| category_type | String | `REVENUE`, `INPUT`, `LPM`, `LBF`, `INSURANCE` |
| is_active | Boolean | Soft delete flag |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

**Unique**: `(farm_id, code)`

### GlAccount
Table: `gl_accounts`

General Ledger accounts mapped to farm categories.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| account_number | String | e.g., `"9660"`, `"9660.1"` |
| account_name | String | e.g., `"Seed"`, `"Seed Treatment"` |
| category_id | UUID? | FK → farm_categories |
| qb_account_id | String? | QuickBooks account reference |
| is_active | Boolean | |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

**Unique**: `(farm_id, account_number)`

### GlActualDetail
Table: `gl_actual_details`

Monthly actuals per GL account for drill-down reporting.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| fiscal_year | Int | |
| month | String | |
| gl_account_id | UUID | FK → gl_accounts |
| amount | Float | |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

**Unique**: `(farm_id, fiscal_year, month, gl_account_id)`

### FarmInvite
Table: `farm_invites`

Pending invitations for users who haven't registered yet.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| email | String | |
| role | String | Default: `"viewer"` |
| invited_by | UUID | User who sent the invite |
| status | String | `pending`, `accepted`, `expired` |
| created_at | DateTime | |
| expires_at | DateTime | 30 days from creation |

**Unique**: `(farm_id, email)`

### OperationalData
Table: `operational_data`

Non-financial operational metrics.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| fiscal_year | Int | |
| month | String | |
| metric | String | `"labour_hours"`, `"equipment_hours"`, `"fuel_litres"` |
| budget_value | Float | Default: 0 |
| actual_value | Float | Default: 0 |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

**Unique**: `(farm_id, fiscal_year, month, metric)`

### AiConversation
Table: `ai_conversations`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | Indexed |
| user_id | UUID | |
| title | String? | |
| created_at | DateTime | |
| updated_at | DateTime | Auto-updated |

### AiMessage
Table: `ai_messages`

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| conversation_id | UUID | FK → ai_conversations. Cascade delete. Indexed |
| role | String | `"user"`, `"assistant"`, `"system"` |
| content | String | |
| context_json | JSONB? | Farm context snapshot at time of query |
| metadata_json | JSONB? | Intent, tokens, etc. |
| created_at | DateTime | |

### FinancialCategory (Legacy)
Table: `financial_categories`

Original fixed category list. Kept for backward compatibility; not actively used.

| Column | Type | Notes |
|--------|------|-------|
| id | Int | Primary key |
| code | String | Unique |
| display_name | String | |
| parent_id | Int? | Self-referential FK |
| path | String | |
| level | Int | |
| sort_order | Int | |
| category_type | String | |

### QbCategoryMapping
Table: `qb_category_mappings`

Maps QuickBooks account names to farm category codes.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | |
| qb_account_name | String | |
| category_code | String | |
| weight | Float | Default: 1.0 (for split allocations) |

**Unique**: `(farm_id, qb_account_name)`

### QbToken
Table: `qb_tokens`

QuickBooks OAuth tokens.

| Column | Type | Notes |
|--------|------|-------|
| id | UUID | Primary key |
| farm_id | UUID | Unique (one token set per farm) |
| access_token | String | Should be encrypted in production |
| refresh_token | String | Should be encrypted in production |
| realm_id | String | QB company ID |
| expires_at | DateTime | |

---

## Additional Model Groups

The following models were added as modules matured. See `backend/src/prisma/schema.prisma` for full column definitions.

### Inventory Models
| Model | Table | Purpose |
|-------|-------|---------|
| `Commodity` | `commodities` | Grain types (Canola, Durum, etc.) |
| `InventoryLocation` | `inventory_locations` | Physical bin locations |
| `InventoryBin` | `inventory_bins` | Individual bins with capacity |
| `CountPeriod` | `count_periods` | Inventory count windows |
| `CountSubmission` | `count_submissions` | User-submitted bin counts |
| `BinCount` | `bin_counts` | Per-bin count records |
| `Contract` | `contracts` | Inventory-side delivery contracts |
| `Delivery` | `deliveries` | Contract deliveries |

### Marketing Models
| Model | Table | Purpose |
|-------|-------|---------|
| `Counterparty` | `counterparties` | Buyers/brokers |
| `MarketingContract` | `marketing_contracts` | Grain sales contracts |
| `MarketPrice` | `market_prices` | Commodity price history |
| `PriceAlert` | `price_alerts` | Price threshold notifications |
| `CashFlowEntry` | `cash_flow_entries` | Projected cash flow line items |
| `MarketingSettings` | `marketing_settings` | Per-farm marketing config |

**Key indexes**: `marketing_contracts(farm_id, commodity_id)`, `marketing_contracts(farm_id, status)`, `price_alerts(farm_id, commodity_id, is_active)`, `cash_flow_entries(farm_id, period_date, entry_type)`

### Logistics Models
| Model | Table | Purpose |
|-------|-------|---------|
| `DeliveryTicket` | `delivery_tickets` | Grain delivery tickets (scale tickets) |
| `Settlement` | `settlements` | Grain buyer settlement documents |
| `SettlementLine` | `settlement_lines` | Individual settlement line items |
| `AiBatch` | `ai_batches` | AI batch processing for settlement OCR |

**Key indexes**: `delivery_tickets(farm_id, delivery_date)`, `delivery_tickets(farm_id, marketing_contract_id)`, `settlements(farm_id, status)`, `ai_batches(farm_id, status)`

### Agronomy Models
| Model | Table | Purpose |
|-------|-------|---------|
| `AgroPlan` | `agro_plans` | Season crop plans |
| `CropAllocation` | `crop_allocations` | Acres per crop per plan |
| `CropInput` | `crop_inputs` | Input products assigned to crops |
| `AgroProduct` | `agro_products` | Product catalog (seed, chem, fert) |
| `SeasonProfile` | `season_profiles` | Reusable season templates |

### Other Models
| Model | Table | Purpose |
|-------|-------|---------|
| `AuditLog` | `audit_logs` | Who changed what, when. Indexed on `(farm_id, entity_type, entity_id)` and `(farm_id, created_at)` |
| `FieldOpsToken` | `field_ops_tokens` | FieldOps integration OAuth tokens |
