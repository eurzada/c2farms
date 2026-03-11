# LGX Terminal Operations

> **Status**: `In Development`
> **Priority**: `High`
> **Owner**:
> **Last Updated**: 2026-03-11

---

## Problem Statement

LGX (Lajord Grain Exchange) is a grain transit terminal operated as a **standalone business unit** from C2 Farms. When C2 delivers grain to LGX, it's treated like any other grower. The terminal receives grain from growers, stores it in bins, blends as needed, and ships outbound to buyers (e.g., JGL) via rail or truck. Without a dedicated terminal management system, inventory, ownership (C2 vs Non-C2), quality tracking, contracts, and settlements live in spreadsheets. Buyers such as JGL need on-demand reporting of grain balances and quality.

---

## Core Function

Manages the full grain terminal lifecycle: **inbound receiving** (truck tickets with grower, weight, quality), **bin inventory** (running balance ledger, C2 vs Non-C2 ownership split), **blending** (ratio-based deductions from source bins to blend target bin), **outbound shipping** (rail car / truck loads with sold-to, FMO), **contracts** (purchase from growers, sale to buyers), **settlements** (payables to growers, receivables from buyers), and **reports** (grain balance PDF/Excel, shipping history, quality summary, contract fulfillment). The module uses `farm_type: 'terminal'` to distinguish LGX from regular farm units. Sidebar and routing switch to terminal-specific views when LGX is selected.

---

## Who Uses This

| Role | Goal |
|------|------|
| Terminal operator / manager | Receive loads, record tickets, run blends, create settlements |
| Admin | Manage bins, counterparties, commodities; void tickets |
| Buyers (e.g., JGL) | Receive on-demand PDF/CSV reports of grain balances and quality |

---

## Enterprise Workflow

1. **Receive inbound**: Growers (including C2) deliver grain; operator creates inbound tickets with grower, product, weight, quality (dockage, moisture, TW, protein, HVK). Tickets auto-update bin balances and C2/Non-C2 ownership.
2. **Bin management**: Each bin has a running ledger. Commodity/product can be reassigned. Sweep/clean clears bin and resets balance.
3. **Blending**: Operator creates blend events with source bins and percentages; system deducts from sources and adds to target bin, preserving ownership ratios.
4. **Outbound**: Ship rail cars or truck loads; record sold-to buyer, FMO, rail car #, seal #s. Outbound tickets reduce bin balances.
5. **Contracts**: Create purchase (from growers) or sale (to buyers) contracts with contracted MT, price/MT, delivery point. Track delivered vs remaining.
6. **Settlements**: Create payable (to grower) or receivable (from buyer) settlements. Link to contracts; optionally update contract delivery. Mark as paid/received.
7. **Reports**: Export grain balance (Excel/PDF), shipping history, quality summary, contract fulfillment for buyers on request.

---

## Interconnections

### Feeds Into
- [[LGX_RECONCILIATION]] — terminal ticket data can support contract-level tonnage reconciliation when C2 ships through LGX
- [[Operational Data]] — terminal inventory and activity feed operational reporting

### Receives From
- Manual data entry (no external integrations yet)
- (Future) Scale API integration for automatic weight capture

### Impacts
- [[Yield & Assumptions]] — LGX is a distinct farm; its commodities and counterparties are farm-scoped
- [[Chart of Accounts]] — (Future) terminal P&L and settlements could flow to GL

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| Scale / weigh bridge | (Future) Weight capture | Inbound |
| Buyer systems (JGL, Bunge, Cargill) | Settlement and reporting recipients | Outbound reports |
| None currently | All data entered manually or via Excel import | — |

---

## Key Business Rules

- **C2 vs Non-C2 ownership**: Each bin tracks `c2_balance_kg` and `non_c2_balance_kg`. Inbound tickets from C2 farms increment C2; others increment Non-C2. Blending preserves ratio.
- **Running balance**: Bin balance is derived from ticket ledger (inbound +, outbound −, blend source −, blend target +). Recalculate available to repair drift.
- **Ticket numbering**: Inbound tickets get auto numbers; outbound tickets use FMO/rail car context. Void sets `status: 'voided'` and reverses balance impact.
- **Contract status**: `executed` → `in_delivery` as deliveries occur → `fulfilled` when remaining MT ≤ 0.
- **Settlement direction**: Payable = money owed to growers; Receivable = money owed from buyers.
- **Farm type**: `Farm.farm_type = 'terminal'` drives sidebar, routes, and module visibility. Terminal routes require `farm_type === 'terminal'` and `requireModule('terminal')`.

---

## Data Model

| Model | Purpose |
|-------|---------|
| `TerminalBin` | Bin number, capacity, current commodity/product, balance, C2/Non-C2 split |
| `TerminalTicket` | Inbound/outbound tickets with weight, quality, grower/buyer |
| `TerminalBlendEvent` | Source bins with percentages → target bin |
| `TerminalSample` | Quality samples linked to tickets |
| `TerminalContract` | Purchase/sale contracts (counterparty, commodity, MT, price) |
| `TerminalSettlement` | Payables/receivables, gross, deductions, net, payment status |
| `DailyPosition` | (Future) Daily position snapshot for reporting |

---

## API Endpoints

| Path | Methods | Purpose |
|------|---------|---------|
| `/api/farms/:farmId/terminal/bins` | GET, PUT | List bins, update bin |
| `/api/farms/:farmId/terminal/bins/:binId/ledger` | GET | Bin transaction ledger |
| `/api/farms/:farmId/terminal/bins/:binId/sweep` | POST | Sweep/clean bin |
| `/api/farms/:farmId/terminal/tickets` | GET, POST | List/create tickets |
| `/api/farms/:farmId/terminal/blends` | GET, POST | List/create blend events |
| `/api/farms/:farmId/terminal/samples` | GET, POST, PUT, DELETE | Sample CRUD |
| `/api/farms/:farmId/terminal/contracts` | GET, POST | List/create contracts |
| `/api/farms/:farmId/terminal/contracts/:id` | PUT | Update contract |
| `/api/farms/:farmId/terminal/settlements` | GET, POST | List/create settlements |
| `/api/farms/:farmId/terminal/settlements/:id/pay` | POST | Mark paid/received |
| `/api/farms/:farmId/terminal/counterparties` | GET, POST | Lookups for forms |
| `/api/farms/:farmId/terminal/commodities` | GET | Lookups for forms |
| `/api/farms/:farmId/terminal/reports/grain-balance/excel` | GET | Export Excel |
| `/api/farms/:farmId/terminal/reports/grain-balance/pdf` | GET | Export PDF |
| `/api/farms/:farmId/terminal/reports/shipping-history` | GET | Export Excel |
| `/api/farms/:farmId/terminal/reports/quality-summary` | GET | Export Excel |
| `/api/farms/:farmId/terminal/reports/contract-fulfillment` | GET | Export Excel |

---

## Export Reports (Buyer-facing)

- **Grain Balance** (Excel, PDF): Bin-level inventory with product, KG, MT, C2 vs Non-C2
- **Shipping History** (Excel): Outbound tickets with date, crop, rail car, FMO, KG, sold-to, seals; filterable by buyer, date range
- **Quality Summary** (Excel): Weighted-average dockage, moisture, TW, protein, HVK per bin
- **Contract Fulfillment** (Excel): Contracts with contracted/delivered/remaining MT, % complete; filterable by buyer

---

## Open Questions

- Should Daily Position be persisted (e.g., end-of-day snapshot) or computed on demand?
- Scale API: which weigh systems will integrate (make, protocol)?
- Should terminal P&L flow into C2 Farms accounting/GL?

---

## Related Notes

- [[LGX_RECONCILIATION]]
- [[Yield & Assumptions]]
- [[Operational Data]]
