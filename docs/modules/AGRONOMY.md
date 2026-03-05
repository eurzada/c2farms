# Agronomy Module — Design Document

## Design Philosophy

One data entry surface, many computed views. The agronomist enters crop allocations and input lines. Everything else — dashboards, procurement summaries, cost aggregations, season timelines — is derived. No redundant storage.

**Two personas, two views of the same data:**
- **Agronomist (Tyson)**: Plan here, export to Cropwise, import results back. A control centre.
- **Executive (Michael)**: See the global view — per-acre costs, procurement scale, cash flow timing, margin impact on marketing decisions.

**Scope boundary**: This module handles planning and monitoring. Procurement (POs, supplier management, purchasing) is a future module — we design the handoff but don't build it.

---

## Data Model

### Core Principle: Plan > Allocation > Inputs

```
AgroPlan (one per farm per crop year)
  └── CropAllocation (one per crop on that farm)
       ├── CropInput[] (seed/fertilizer/chemical product lines)
       └── Nutrient targets + soil data (fields on allocation)
```

Everything else is a **query**:
- Executive Dashboard = aggregate across plans
- Procurement Summary = aggregate inputs across plans by product
- Season Timeline = allocations + input timings
- Budget vs Actual = plan inputs vs Cropwise actuals
- Forecast feed = plan costs allocated to fiscal months

### Prisma Models

```prisma
// Container: one plan per farm per crop year
model AgroPlan {
  id            String    @id @default(uuid())
  farm_id       String
  crop_year     Int                          // e.g., 2026
  status        String    @default("draft")  // draft | submitted | approved | locked
  prepared_by   String?                      // user name (agronomist)
  approved_by   String?                      // user name (executive)
  approved_at   DateTime?
  notes         String?
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt

  farm          Farm          @relation(fields: [farm_id], references: [id])
  allocations   CropAllocation[]

  @@unique([farm_id, crop_year])
  @@map("agro_plans")
}

// One crop on one farm: acres, yield target, commodity price, nutrient targets
model CropAllocation {
  id                String   @id @default(uuid())
  plan_id           String
  crop              String                   // "Canola", "Spring Wheat", "Spring Durum Wheat", etc.
  acres             Float
  target_yield_bu   Float                    // bu/acre
  commodity_price   Float                    // $/bu assumption
  sort_order        Int      @default(0)

  // Nutrient planning (agronomist sets per crop)
  n_rate_per_bu     Float?                   // lbs N removed per bushel
  p_rate_per_bu     Float?
  k_rate_per_bu     Float?
  s_rate_per_bu     Float?
  available_n       Float?                   // soil test available N (lbs/ac)

  plan              AgroPlan     @relation(fields: [plan_id], references: [id], onDelete: Cascade)
  inputs            CropInput[]

  @@unique([plan_id, crop])
  @@map("crop_allocations")
}

// Individual product line (seed, fertilizer, or chemical)
model CropInput {
  id                String   @id @default(uuid())
  allocation_id     String
  category          String                   // seed | seed_treatment | fertilizer | chemical
  product_name      String                   // "InVigor L233P", "NH3", "Liberty"
  product_analysis  String?                  // nutrient analysis: "82-0-0", "11-52-0", "12-40-0-10-1"
  form              String?                  // dry | liquid | nh3 | micro_nutrient | granular
  timing            String?                  // fall_residual | preburn | incrop | fungicide | desiccation
  rate              Float
  rate_unit         String                   // lbs/acre | L/acre | US Gal/Acre | per acre
  cost_per_unit     Float                    // $/lb, $/L, $/acre
  sort_order        Int      @default(0)

  // Computed on read (not stored): cost_per_acre = rate * cost_per_unit
  // Computed on read: total_cost = cost_per_acre * allocation.acres

  allocation        CropAllocation @relation(fields: [allocation_id], references: [id], onDelete: Cascade)

  @@map("crop_inputs")
}

// Master product reference (dropdown data for the agronomist)
model AgroProduct {
  id                String   @id @default(uuid())
  farm_id           String
  name              String
  type              String                   // seed | fertilizer | chemical | adjuvant
  sub_type          String?                  // herbicide | fungicide | insecticide | growth_reg | defoamer
  crop_filter       String?                  // comma-separated crops this applies to (null = all)
  analysis_code     String?                  // "46-0-0", "11-52-0" (fertilizers only)
  default_unit      String?
  default_rate      Float?
  default_cost      Float?

  farm              Farm @relation(fields: [farm_id], references: [id])

  @@unique([farm_id, name, type])
  @@map("agro_products")
}

// Season timeline cost allocation (how input costs distribute across months)
model SeasonProfile {
  id                String   @id @default(uuid())
  farm_id           String
  crop              String
  crop_year         Int
  // Monthly cost allocation percentages (Apr-Oct)
  apr_pct           Float    @default(0)
  may_pct           Float    @default(0)
  jun_pct           Float    @default(0)
  jul_pct           Float    @default(0)
  aug_pct           Float    @default(0)
  sep_pct           Float    @default(0)
  oct_pct           Float    @default(0)

  farm              Farm @relation(fields: [farm_id], references: [id])

  @@unique([farm_id, crop, crop_year])
  @@map("season_profiles")
}
```

### What We DON'T Store

- **Nutrient applied/required/inventory** — computed from `CropInput` lines where `category='fertilizer'` using `product_analysis` parsing
- **Cost per acre subtotals** — computed: `rate * cost_per_unit`
- **Total cost** — computed: `cost_per_acre * allocation.acres`
- **Farm-level totals** — aggregated from allocations
- **Cross-farm totals** — aggregated from plans
- **Procurement quantities** — aggregated from inputs across plans by product
- **Revenue projections** — `acres * target_yield_bu * commodity_price`
- **Gross margin** — revenue - total input cost

### Reuse from Existing Schema

| Existing Model | How Agronomy Uses It |
|---|---|
| `Farm` | Parent of `AgroPlan`. Farm selector in UI. |
| `InventoryLocation` | Maps to farm names (Lewvan, Hyas, etc.) for display. Region, soil zone, rainfall as location metadata. |
| `Commodity` | Reference for `lbs_per_bu` conversions. Not FK'd from CropAllocation (crop names don't always match commodity names). |
| `FarmCategory` | `input_seed`, `input_fert`, `input_chem` — approved plan costs feed into Forecast via these categories. |
| `MonthlyData` | Approved plan costs, distributed by `SeasonProfile` percentages, write into monthly budget data. |

---

## Screens

### 1. Plan Setup (Farm Master + Allocations)

**Route**: `/agronomy/plan`

**What it shows**:
- Plan header: crop year, status badge (Draft/Submitted/Approved/Locked), prepared by, approved by
- Approval action buttons (Submit for Review / Approve / Lock — role-gated)
- Farm metadata: region, soil zone, avg rainfall, total acres (from InventoryLocation)
- **Crop allocation grid** (ag-Grid, editable):
  | Crop | Acres | Target Yield (bu/ac) | Price ($/bu) | Est. Production (bu) | Gross Revenue ($) |
  - Computed columns: production = acres * yield, revenue = production * price
  - Row for each crop, total row at bottom
  - Commodity assumptions inline

**Who uses it**: Agronomist sets allocations, executive reviews before approval.

### 2. Crop Input Plan (The Main Working Surface)

**Route**: `/agronomy/inputs`

**What it shows**:
- **Farm tabs** across the top (Lewvan | Hyas | Stockholm | Balcarres | Provost | Ridgedale)
- For each farm, **crop sections** (collapsible accordion or grouped grid):

**Per crop block** (mirrors the Excel farm sheet structure):
```
Canola — 10,607 ac — Target: 55 bu/ac
  SEEDING                    Rate    Unit      $/Unit    $/Acre    Total $
  InVigor L233P               5     lbs/ac     12.50     62.50    662,938
  Seed Treatment              1     per acre    8.50      8.50     90,160
                                              Subtotal:  71.00    753,097

  FERTILIZER                 Rate    Unit      $/Unit    $/Acre    Total $
  [Nutrient sidebar: Required N=133, P=-44, K=-30, S=17 | Applied: N=271, P=126...]
  NH3 (82-0-0)              100    lbs/ac      0.65     64.97    689,137
  Treated Urea (46-0-0)     100    lbs/ac      0.34     34.00    360,638
  ...
                                              Subtotal: 268.93  2,852,541

  CHEMICALS                  Rate    Unit      $/Unit    $/Acre    Timing
  Avadex                     2.5    L/ac        8.50     21.25    Fall Residual
  Bromo                      0.5    L/ac       42.00     21.00    Preburn
  Liberty                    0.5    L/ac       85.00     42.50    Incrop
  ...
                                              Subtotal: 103.50  1,097,825

  TOTAL CROP INPUT:                                     443.43  4,703,462
```

- Product dropdowns pull from `AgroProduct` (filtered by crop and category)
- Fertilizer section includes a nutrient reconciliation panel:
  - Target nutrients (from yield * rate/bu - available N)
  - Applied nutrients (parsed from product_analysis * rate)
  - Surplus/deficit indicators
- Add/remove input lines inline
- Copy crop program from another farm (common pattern: Stockholm copies Hyas's canola program)

**Who uses it**: Agronomist builds and refines programs. This is the primary working surface.

### 3. Dashboard (Executive View)

**Route**: `/agronomy/dashboard`

**What it shows**:
- **KPI cards**: Total Acres, Total Input Budget, Projected Revenue, Projected Margin
- **Cost by Farm table** (read-only ag-Grid):
  | Farm | Acres | Seed $ | Fert $ | Chem $ | Total Input $ | $/Acre | Revenue $ | Margin $ | Margin % | Status |
- **Cost by Crop table**:
  | Crop | Acres | Seed $ | Fert $ | Chem $ | Total $ | $/Acre | Yield | $/Bushel | Revenue/Ac | Margin/Ac | % Budget |
- **Budget Guardrails** section (in-season):
  | Farm | Budgeted | Actual | Variance | Var % | Budget Status | Yield Status |
  - Color-coded: green (+-5%), yellow (5-10%), red (>10%), grey (pre-season)
  - Rules displayed: "Managers may NOT exceed budget" / "May NOT cut inputs below plan"
- **Cash flow timing** (from SeasonProfile): monthly stacked bar chart showing when input spend hits by crop

**Who uses it**: Executive reviews global position, makes vendor/pricing decisions, monitors guardrails in-season.

### 4. Reports & Exports (Not a screen — actions from Dashboard)

**Export buttons on Dashboard**:
- **Procurement Summary** (Excel): aggregated product quantities across all farms — what to buy, how much, estimated cost, delivery window. This is the handoff to future Procurement module.
- **Plan PDF**: per-farm crop input detail for farm manager communication
- **Cropwise Export**: formatted for Cropwise import (field boundaries, crop assignments, product plans)

---

## Service Layer

### `agronomyService.js`

```
Core CRUD:
  getPlan(farmId, cropYear)
  createPlan(farmId, cropYear, data)
  updatePlanStatus(planId, status, userId)
  getAllocations(planId)
  upsertAllocation(planId, data)
  deleteAllocation(allocationId)
  getInputs(allocationId)
  upsertInput(allocationId, data)
  deleteInput(inputId)

Computed Views:
  getFarmSummary(planId)           -> cost by category (seed/fert/chem), $/acre, totals
  getCropSummary(farmId, cropYear) -> cost by crop across farm
  getExecutiveDashboard(farmId, cropYear) -> cross-farm aggregation (queries all plans for farm's org)
  getNutrientBalance(allocationId) -> target vs applied nutrients
  getProcurementSummary(farmId, cropYear) -> aggregated product quantities

Integration:
  pushToForecast(planId)          -> writes approved plan costs into MonthlyData via SeasonProfile %
  exportCropwise(planId)          -> generates Cropwise-compatible export
  importCropwiseActuals(farmId, data) -> updates Budget vs Actual from Cropwise
```

### Nutrient Calculation Engine

Pure function, no storage:

```javascript
function parseAnalysis(code) {
  // "82-0-0" -> { n: 82, p: 0, k: 0, s: 0 }
  // "12-40-0-10-1" -> { n: 12, p: 40, k: 0, s: 10, zn: 1 }
  const parts = code.split('-').map(Number);
  return { n: parts[0]||0, p: parts[1]||0, k: parts[2]||0, s: parts[3]||0, ...extras };
}

function computeNutrientBalance(allocation, fertInputs) {
  const required = {
    n: allocation.target_yield_bu * allocation.n_rate_per_bu - (allocation.available_n || 0),
    p: allocation.target_yield_bu * allocation.p_rate_per_bu,
    k: allocation.target_yield_bu * allocation.k_rate_per_bu,
    s: allocation.target_yield_bu * allocation.s_rate_per_bu,
  };

  const applied = { n: 0, p: 0, k: 0, s: 0 };
  for (const input of fertInputs) {
    const analysis = parseAnalysis(input.product_analysis);
    // rate is lbs/acre of product; each lb delivers analysis% of each nutrient
    applied.n += input.rate * (analysis.n / 100);
    applied.p += input.rate * (analysis.p / 100);
    applied.k += input.rate * (analysis.k / 100);
    applied.s += input.rate * (analysis.s / 100);
  }

  return { required, applied, surplus: { n: applied.n - required.n, ... } };
}
```

Wait — looking at the Excel data more carefully, the analysis codes like "82-0-0" mean 82% N by weight. So 100 lbs of NH3 (82-0-0) delivers 82 lbs of N. The rate in the Excel is lbs/acre of the product, and the analysis gives nutrient lbs per 100 lbs of product. So `applied_N = rate * analysis_n / 100`.

Actually in the spreadsheet, the nutrient columns show the raw analysis numbers (82, 46, 52, 60, etc.) and the rates are in lbs/acre. The computation is: `applied_nutrient_lbs_per_acre = rate_lbs_per_acre * (analysis_pct / 100)`. But looking at the data: NH3 at 100 lbs/ac with analysis 82 shows 82 in the N column — that's `100 * 82/100 = 82`. Confirmed.

---

## Routes

```
GET    /api/farms/:farmId/agronomy/plans?year=2026
POST   /api/farms/:farmId/agronomy/plans
PATCH  /api/farms/:farmId/agronomy/plans/:planId
PATCH  /api/farms/:farmId/agronomy/plans/:planId/status    (submit/approve/lock)

GET    /api/farms/:farmId/agronomy/plans/:planId/allocations
POST   /api/farms/:farmId/agronomy/plans/:planId/allocations
PATCH  /api/farms/:farmId/agronomy/allocations/:id
DELETE /api/farms/:farmId/agronomy/allocations/:id

GET    /api/farms/:farmId/agronomy/allocations/:id/inputs
POST   /api/farms/:farmId/agronomy/allocations/:id/inputs
PATCH  /api/farms/:farmId/agronomy/inputs/:id
DELETE /api/farms/:farmId/agronomy/inputs/:id

GET    /api/farms/:farmId/agronomy/dashboard?year=2026
GET    /api/farms/:farmId/agronomy/procurement?year=2026
GET    /api/farms/:farmId/agronomy/nutrients/:allocationId

POST   /api/farms/:farmId/agronomy/plans/:planId/push-to-forecast
GET    /api/farms/:farmId/agronomy/plans/:planId/export/cropwise
GET    /api/farms/:farmId/agronomy/plans/:planId/export/excel
GET    /api/farms/:farmId/agronomy/plans/:planId/export/pdf

GET    /api/farms/:farmId/agronomy/products              (master product list)
POST   /api/farms/:farmId/agronomy/products
PATCH  /api/farms/:farmId/agronomy/products/:id
DELETE /api/farms/:farmId/agronomy/products/:id

POST   /api/farms/:farmId/agronomy/import/workbook        (Excel import from existing worksheet)
```

---

## Forecast Integration (How Agronomy Feeds Forecast)

When a plan is approved, `pushToForecast` distributes costs into `MonthlyData`:

1. For each crop allocation, sum input costs by category (seed, fertilizer, chemical)
2. Look up the `SeasonProfile` for that crop to get monthly % allocation
3. Write per-unit values ($/acre) into `MonthlyData` for the appropriate fiscal months and categories (`input_seed`, `input_fert`, `input_chem`)
4. `calculationService` handles the per-unit -> accounting conversion automatically

**Example**: Canola total input = $443.43/ac. Season profile says 45% in May. So May `input_seed` + `input_fert` + `input_chem` entries get their proportional share. More precisely, each category distributes independently since seed is purchased in Apr-May while chemicals span Apr-Sep.

**Cash flow view for executive**: The SeasonProfile percentages, multiplied by total input costs per crop, give the monthly cash outflow forecast. This is critical for the executive's cash management.

---

## Implementation Phases

### Phase 1: Data Model + Seed + Farm Master Screen
- Add Prisma models (AgroPlan, CropAllocation, CropInput, AgroProduct, SeasonProfile)
- Seed script from Excel workbook data (all 6 farms, ~7 crops each, full input programs)
- Seed AgroProduct reference data from Input Index sheet
- Backend: plan CRUD routes, allocation CRUD routes
- Frontend: Plan Setup page with crop allocation grid
- Frontend: AgronomyLayout with tab navigation, sidebar entry, App.jsx routes

### Phase 2: Crop Input Plan Screen
- Backend: input CRUD routes, nutrient calculation endpoint
- Frontend: Crop Input Plan page — farm tabs, crop sections, editable ag-Grid
- Nutrient reconciliation panel (target vs applied)
- Product dropdown from AgroProduct reference
- Copy program across farms

### Phase 3: Executive Dashboard + Reports
- Backend: dashboard aggregation endpoint, procurement summary endpoint
- Frontend: Dashboard page — KPI cards, cost-by-farm table, cost-by-crop table
- Budget guardrails section
- Cash flow timing chart (from SeasonProfile)
- Export: procurement summary Excel, plan PDF

### Phase 4: Approval Workflow + Forecast Integration
- Plan status transitions (draft -> submitted -> approved -> locked)
- Role-gated actions (agronomist submits, executive approves)
- pushToForecast service — write approved costs into MonthlyData
- Budget vs Actual framework (placeholder for Cropwise import)

### Phase 5: Cropwise Integration (Future)
- Export plan to Cropwise format
- Import actuals from Cropwise (as-applied records)
- Update Budget vs Actual with real data
- Variance alerts

---

## What This Module Does NOT Include

- **Procurement**: No POs, supplier management, or purchasing workflows. The Procurement Summary is a report that the future Procurement module consumes.
- **Field-level mapping**: No GIS/spatial data. Crops are allocated at the farm level, not field level. Cropwise handles field-level execution.
- **In-season scouting**: Handled in Cropwise. We import results, we don't replicate the mobile scouting tool.
- **Equipment scheduling**: Referenced in Season Timeline but managed in future Equipment module.
- **Blend optimization**: The agronomist selects products manually. No automatic "find the cheapest blend to hit nutrient targets" solver (could be a future enhancement).

---

## Key Design Decisions

1. **`CropAllocation` not `Field`**: We plan at crop-per-farm level, not field level. Fields are Cropwise's domain. This avoids duplicating field boundary data and keeps the model simple.

2. **Nutrient data on `CropAllocation`**: N/P/K/S rates per bushel and available N are stored per allocation because they vary by farm (soil tests) and crop. Not a separate table — it's 1:1 with allocation.

3. **`CropInput` is flat, not category-specific tables**: One table for seed, fertilizer, and chemical inputs. The `category` field distinguishes them. This simplifies CRUD and the ag-Grid UI (one grid with sections, not three separate grids).

4. **`AgroProduct` is farm-scoped**: Product lists can differ by farm (different seed cleaners, different supplier programs). Seeded from Input Index but editable per farm.

5. **`SeasonProfile` handles cash flow timing**: Rather than hard-coding when costs hit, each crop has a configurable monthly distribution. This feeds both the cash flow chart and the Forecast integration.

6. **No stored aggregates**: Dashboard, procurement summary, cost rollups are all computed at query time. The source of truth is the plan + allocations + inputs. This eliminates sync issues.

7. **Plan status as guardrail**: Once approved, the plan is immutable (locked). Mid-season changes require executive unlock. This enforces the "budget guardrail" business rule.
