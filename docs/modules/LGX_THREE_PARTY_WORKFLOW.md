# LGX Three-Party Workflow

> **Status**: `Design Complete`
> **Priority**: `High`
> **Last Updated**: 2026-03-26

---

## Overview

LGX (Lajord Grain Exchange) is a transloading terminal operated as a **business unit** of C2 Farms. This document defines the three-party workflow between C2 Farms (producer), LGX (terminal/service provider), and buyers (e.g., JGL).

**Key principle**: Grain sale and transloading are **two separate transactions**. LGX never owns the grain. LGX provides a blending/transloading service.

---

## Entities

| Entity | Role | System Identity |
|--------|------|-----------------|
| **C2 Farms** (Enterprise) | Producer — owns and sells grain | Enterprise farm (`is_enterprise=true`) |
| **C2 BU Farms** (Hyas, Lewvan, etc.) | Source farms — grow and ship grain | Individual farm records |
| **LGX** | Terminal — receives, blends, ships grain | Farm record (`farm_type='terminal'`) |
| **Buyer** (JGL, Cargill, etc.) | Purchases grain from C2, pays LGX for transloading | Counterparty record |

---

## Three Transactions

### Transaction 1: Grain Sale (C2 Farms -> Buyer)

C2 Farms signs a `MarketingContract` with the buyer for a specified commodity, grade, and quantity. The buyer pays C2 Farms directly for the grain. This is a standard marketing contract with `delivery_method: 'terminal'` indicating grain is routed through LGX.

```
  MarketingContract (C2 Enterprise <-> JGL)
  ─────────────────────────────────────────
  Contract #30040: 1000 MT Durum #2 @ $280/MT
  delivery_method: 'terminal'
  terminal_farm_id: <LGX farm_id>

  JGL settles → $280,000 → C2 Farms Enterprise
  Creates enterprise Settlement record
```

### Transaction 2: Transloading Fee (LGX -> Buyer)

LGX charges the buyer a flat $/MT fee for transloading services (receiving, storage, blending, rail car loading). This is LGX business unit revenue, completely independent of the grain payment.

```
  TerminalContract (LGX <-> JGL)
  ─────────────────────────────────
  contract_purpose: 'transloading_service'
  transloading_rate: $12/MT
  marketing_contract_id: <link to Contract #30040>

  LGX invoices JGL: 1000 MT × $12/MT = $12,000
  Creates TerminalSettlement type 'transloading'
```

### Transaction 3: Internal BU Credits (C2 Internal)

When Transaction 1 settles, the system allocates the grain payment to the BU farms that contributed grain, using **grade-adjusted** pricing when available.

```
  TerminalSettlement type 'bu_credit' (one per contributing BU)
  ────────────────────────────────────────────────────────────

  Grade-adjusted allocation (using grade_prices_json):
    #1 base: $290/MT, #3 base: $275/MT
    Weighted avg: (300×290 + 700×275) / 1000 = $279.50/MT

    Hyas BU:   300 MT × ($290/$279.50) × $277.50/MT = $86,367
    Lewvan BU: 700 MT × ($275/$279.50) × $277.50/MT = $191,133
                                              Total = $277,500

  Fallback (no grade_prices_json): proportional by weight
    Hyas:   300/1000 × $277,500 = $83,250
    Lewvan: 700/1000 × $277,500 = $194,250
```

---

## Physical Grain Flow

```
  BU FARMS                              LGX TERMINAL                              BUYER (JGL)
  ════════                              ════════════                              ═══════════

  Hyas (300 MT Durum #1) ───truck──┐
                                    ├──► RECEIVING ──► BIN STORAGE ──► BLENDING ──► RAIL CAR ──► JGL RECEIVES
  Lewvan (700 MT Durum #3) ─truck─┘    (inbound        (TerminalBin)   (BlendEvent)  (outbound     1000 MT
                                         ticket)        raw_material     WIP            ticket)      Durum #2
                                                                                       finished_goods
```

### Inventory State Machine

```
  ┌────────────┐    inbound     ┌──────────────┐   blend    ┌─────────┐   outbound   ┌──────────────┐   ship     ┌─────────┐
  │ IN TRANSIT │───ticket────►  │ RAW MATERIAL │──event──►  │   WIP   │───ticket──►  │ FINISHED     │──confirm►  │ SHIPPED │
  │ (on truck) │                │ (in LGX bin) │            │ (blend) │              │ GOODS (car)  │            │         │
  └────────────┘                └──────────────┘            └─────────┘              └──────────────┘            └─────────┘
```

---

## Document / Ticket Flow

```
  C2 BU FARMS          TRACTION AG             LGX TERMINAL             JGL / BUYER
  ═══════════          ══════════              ══════════              ══════════

  Ship grain ─────► DeliveryTicket ────┐
  (weigh scale)     #4501-4552          │
  (52 loads)                            │   TerminalTicket
                                        ├─► #1134-1186 ──► LGX Bins
                                            (52 inbound)       │
                                                               ▼
                                                         BlendEvent
                                                               │
                                                               ▼
                                                         TerminalTicket
                                                         #5779-5803 ─────► JGL receives
                                                         (25 outbound)      rail cars
                                                                               │
                            ┌──────────────────────────────────────────────────┘
                            ▼
                   JGL Settlement PDF uploaded to C2 system
                   → extract lines → match to MarketingContract #30040
                   → tonnage-level reconciliation (NOT ticket-level)
                   → BU credit allocation triggered on approval
```

---

## Financial Flow

```
  ┌─────────────────────────────────────────────────────────────────────────────────┐
  │                              MONEY FLOW                                         │
  │                                                                                 │
  │   JGL ──── $280,000 (grain) ────────────────────────────────► C2 Farms          │
  │    │                                                          Enterprise        │
  │    │                                                              │              │
  │    │                                                    BU Credit Cascade        │
  │    │                                                              │              │
  │    │                                                    ┌─────────┴──────────┐   │
  │    │                                                    ▼                    ▼   │
  │    │                                              Hyas BU              Lewvan BU │
  │    │                                              $86,367              $191,133  │
  │    │                                                                             │
  │    └──── $12,000 (transloading) ──────► LGX BU Revenue                          │
  │                                                                                 │
  └─────────────────────────────────────────────────────────────────────────────────┘
```

---

## Settlement Cascade (Step by Step)

### Step 1: Upload & Extract
- Admin uploads JGL settlement PDF to C2 Farms enterprise (Logistics > Settlements)
- System extracts: 25 rail car lines, 1000 MT net, $280K gross, deductions -> $277,500 net
- Matches to `MarketingContract` #30040 by contract number
- Creates enterprise `Settlement` record with `terminal_settlement_id` link

### Step 2: Tonnage Reconciliation
- System detects `MarketingContract.delivery_method = 'terminal'`
- Switches to **tonnage-level reconciliation** (not ticket-level)
- Aggregates: 52 C2 DeliveryTickets (Traction Ag) totaling ~1,020 MT field weight
- Compares to: 1,000 MT on JGL settlement
- Variance: -2% (normal — dockage, moisture, shrink)
- Admin approves tonnage match

### Step 3: BU Credit Allocation (triggered by approval)
- System queries `TerminalTicket` where `is_c2_farms = true` and linked to this contract
- Groups by source farm (via `grower_name` or BU mapping)
- Applies **grade-adjusted allocation** using `grade_prices_json` from MarketingContract
- Creates `TerminalSettlement` type `bu_credit` per contributing BU farm
- Each record stores: `source_bu_farm_id`, `allocation_basis: 'grade_adjusted'`, net amount

### Step 4: Contract & Cash Flow Update
- `MarketingContract` #30040 -> `status: 'fulfilled'`, `settlement_amount: $277,500`
- `CashFlowEntry` created for the receipt month

### Step 5: Transloading Invoice (Independent)
- LGX operator creates transloading settlement at any time (before or after grain settlement)
- Calculated from outbound ticket tonnage × transloading rate
- `TerminalSettlement` type `transloading`: 1,000 MT x $12/MT = $12,000
- Generates PDF invoice for JGL
- This is LGX BU revenue — appears on LGX P&L

---

## Reconciliation Strategy

Three ticket numbering systems that never match 1:1:

| System | Ticket Numbers | Source | Count |
|--------|---------------|--------|-------|
| Traction Ag (C2 BU) | #4501-4552 | Farm weigh scales | 52 truck loads |
| LGX Terminal | #1134-1186 | LGX receiving scale | 52 inbound tickets |
| JGL Settlement | #5779-5803 | JGL rail car receipts | 25 rail cars |

### Three-Layer Reconciliation

| Layer | Left Side | Right Side | Match By | Granularity |
|-------|-----------|------------|----------|-------------|
| **1. C2 <-> LGX** | DeliveryTicket (52) | TerminalTicket inbound (52) | ticket#, FMO, date+weight | Ticket-level |
| **2. LGX <-> JGL** | TerminalTicket outbound (25) | JGL Settlement lines (25) | rail_car_number | Rail-car level |
| **3. Contract Tonnage** | Sum of Layer 1 inbound | Sum of Layer 2 settled | aggregate MT | Contract-level |

**Layer 3 is the primary admin approval** — "I match the tonnage, not the actual tickets."

Layers 1 and 2 provide drill-down detail and audit trail.

---

## Dual Mode: C2 Grain vs Third-Party Grain

LGX handles two types of grain:

### C2 Grain (NEW three-party model)
- `TerminalTicket.is_c2_farms = true`
- C2 sells directly to buyer (MarketingContract)
- LGX charges transloading fee
- BU credit allocation on settlement

### Non-C2 Grain (existing intermediary model)
- `TerminalTicket.is_c2_farms = false`
- LGX buys from third-party grower (TerminalContract direction: 'purchase')
- LGX sells to buyer (TerminalContract direction: 'sale')
- LGX earns spread between buy and sell price
- Existing `computeRealization()` logic still applies for non-C2 grain

The `is_c2_farms` flag on `TerminalTicket` determines which flow to use.

---

## Schema Changes

### MarketingContract — add terminal routing
```prisma
model MarketingContract {
  // ... existing fields ...
  delivery_method     String    @default("direct")  // direct | terminal
  terminal_farm_id    String?                        // FK to Farm (farm_type='terminal')
  // ... existing fields ...
  terminal_farm       Farm?     @relation("TerminalRoutedContracts", fields: [terminal_farm_id], references: [id])
}
```

### TerminalContract — distinguish grain trade vs service
```prisma
model TerminalContract {
  // ... existing fields ...
  contract_purpose      String    @default("grain_trade")  // grain_trade | transloading_service
  transloading_rate     Float?                              // $/MT for transloading
  marketing_contract_id String?                             // link to C2 MarketingContract
  // ... existing fields ...
  marketing_contract    MarketingContract? @relation("TransloadingAgreement", fields: [marketing_contract_id], references: [id])
}
```

### TerminalTicket — add inventory stage + contract link
```prisma
model TerminalTicket {
  // ... existing fields ...
  inventory_stage       String    @default("raw_material")  // raw_material | wip | finished_goods | shipped
  marketing_contract_id String?                              // which C2-JGL contract this grain fulfills
  // ... existing fields ...
  marketing_contract    MarketingContract? @relation("TerminalGrainLink", fields: [marketing_contract_id], references: [id])
}
```

### TerminalSettlement — redefine types + BU credit fields
```prisma
model TerminalSettlement {
  // ... existing fields ...
  type                  String    @default("bu_credit")  // bu_credit | transloading | grain_sale
  source_bu_farm_id     String?                           // for bu_credit: which BU farm
  allocation_basis      String?                           // proportional | grade_adjusted
  // ... existing fields ...
  source_bu_farm        Farm?     @relation("BuCreditAllocations", fields: [source_bu_farm_id], references: [id])
}
```

### TerminalBlendEvent — add contract link
```prisma
model TerminalBlendEvent {
  // ... existing fields ...
  marketing_contract_id String?
  marketing_contract    MarketingContract? @relation("BlendForContract", fields: [marketing_contract_id], references: [id])
}
```

---

## New Service: buCreditAllocationService.js

### Purpose
Takes a settled MarketingContract (with `delivery_method: 'terminal'`) and creates grade-adjusted BU credit allocation records.

### Functions

```javascript
/**
 * Compute BU credit allocations for a terminal-routed contract.
 * @param {string} farmId - LGX terminal farm ID
 * @param {string} marketingContractId - The settled MarketingContract
 * @param {number} settlementNetAmount - Net amount from buyer settlement
 * @returns {Array<{bu_farm_id, bu_farm_name, contributed_mt, grade, allocated_amount, rate_per_mt}>}
 */
computeAllocations(farmId, marketingContractId, settlementNetAmount)

/**
 * Create TerminalSettlement type='bu_credit' records from computed allocations.
 * @param {string} farmId - LGX terminal farm ID
 * @param {string} marketingContractId
 * @param {Array} allocations - Output from computeAllocations
 * @returns {Array<TerminalSettlement>}
 */
createBuCredits(farmId, marketingContractId, allocations)

/**
 * Full cascade: compute + create + update contract status.
 * Called when admin approves a grain sale settlement reconciliation.
 */
processBuCreditCascade(farmId, marketingContractId, settlementNetAmount, io)
```

### Algorithm (grade-adjusted)
1. Query `TerminalTicket` where `is_c2_farms=true`, `marketing_contract_id` matches, `direction='inbound'`
2. Group by source BU farm (mapped from `grower_name`)
3. Sum MT per BU, note grade per ticket
4. Look up `grade_prices_json` from MarketingContract (e.g., `[{grade: "#1", price_per_mt: 290}, {grade: "#3", price_per_mt: 275}]`)
5. Compute weighted average price across all contributions
6. Adjust each BU's allocation: `bu_mt × (bu_grade_price / weighted_avg) × (settlement_net / total_mt)`
7. Verify total allocations sum to settlement net amount (rounding adjustment on largest BU)

---

## API Changes

### Modified Endpoints

| Method | Path | Change |
|--------|------|--------|
| `POST` | `/:farmId/terminal/contracts` | Accept `contract_purpose`, `transloading_rate`, `marketing_contract_id` |
| `PUT` | `/:farmId/terminal/contracts/:id` | Allow updating new fields |
| `POST` | `/:farmId/terminal/settlements` | Accept new type values (`bu_credit`, `grain_sale`) |
| `POST` | `/:farmId/terminal/tickets` | Accept `inventory_stage`, `marketing_contract_id` |

### New Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| `POST` | `/:farmId/terminal/contracts/:id/bu-credits` | Trigger BU credit allocation for a settled contract |
| `GET` | `/:farmId/terminal/contracts/:id/bu-credits` | View BU credit breakdown for a contract |
| `POST` | `/:farmId/terminal/contracts/:id/transloading-invoice` | Generate transloading invoice from outbound tickets |
| `GET` | `/:farmId/terminal/reconciliation/:contractId/tonnage` | Three-layer tonnage reconciliation view |

---

## Implementation Phases

### Phase 1: Schema & Core Service Realignment
- Schema changes (new fields on MarketingContract, TerminalContract, TerminalTicket, TerminalSettlement, TerminalBlendEvent)
- `buCreditAllocationService.js` (new)
- Data migration for existing records
- **Files**: `schema.prisma`, `terminalContractService.js`, new service

### Phase 2: Settlement Flow Rewrite
- Grain sale settlements -> enterprise `Settlement` table
- Tonnage-level reconciliation for terminal-routed contracts
- BU credit cascade on approval
- Deprecate `computeRealization` / `pushBuyerToLogistics` for C2 grain
- **Files**: `terminalSettlementService.js`, `lgxTransferReconciliationService.js`, `terminal.js` routes

### Phase 3: Transloading Invoice Enhancement
- Transloading contract creation (rate/MT)
- Auto-generate transloading settlement from outbound tickets
- Invoice PDF generation
- LGX revenue dashboard

### Phase 4: Frontend Rethink
- Contracts page: "Grain Contracts" + "Transloading Agreements"
- Settlements page: "Grain Settlements" + "Transloading Invoices" + "BU Credits"
- Dashboard: throughput + revenue + BU contribution
- Three-layer reconciliation dialog

### Phase 5: Reporting & GL Integration
- BU credit allocation report
- LGX P&L (transloading revenue - operating costs)
- Inventory flow report
- QuickBooks journal entries

---

## References

- Previous design docs (superseded by this document):
  - `docs/modules/LGX_TERMINAL_OPERATIONS.md` — physical operations (still valid)
  - `docs/modules/LGX_ACCOUNTING.md` — inter-company accounting (partially superseded)
  - `docs/modules/LGX_TRANSFER_AGREEMENTS.md` — transfer agreement concept (superseded)
  - `docs/modules/LGX_RECONCILIATION.md` — tonnage reconciliation (refined here)
- Real-world reference: JGL Contract #30040 (52 trucks -> 25 rail cars, 2,520 MT Durum)
