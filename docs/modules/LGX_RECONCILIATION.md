# LGX Tonnage Reconciliation — Design Plan

## Status: PLANNING (pending user conversations)

## Problem Statement

When C2 Farms ships grain through their own terminal (LGX / Lajord Grain Exchange) to a third-party buyer, the standard ticket-number reconciliation breaks down completely.

**Normal flow** (direct to buyer elevator):
```
C2 bins → Truck (weigh scale ticket #12345) → Buyer elevator
Buyer settles with ticket #12345 → 1:1 match ✓
```

**LGX flow** (through C2's terminal):
```
C2 bins → 52 trucks → LGX (LGX tickets #1134-1222)
           ↓ grain pooled/blended at LGX
LGX → 25 rail cars → JGL (rail tickets #5779-5803)
JGL settles with rail car tickets → NO match possible ✗
```

**Why matching fails:**
1. LGX ticket numbers (1134) ≠ JGL rail car ticket numbers (5779) — different systems
2. 52 truck loads ≠ 25 rail cars — grain was pooled/blended, no 1:1 correspondence
3. Individual truck load weights (~42 MT) don't correspond to rail car weights (~100 MT)
4. Scored matching (weight/date/commodity) can't help — unit sizes are fundamentally different

**Admin's current workaround:** "I match the tonnage, not the actual tickets"

## Real-World Example: JGL Contract #30040

### Contract
- Buyer: JGL Commodities Ltd (Moose Jaw, SK)
- Contract #: 30040, dated 11/20/2025
- Commodity: C204 Durum (Milling Quality, 2CWAD or Better)
- Quantity: 2,500 MT @ $279.25/MT CDN
- Ship mode: Rail, loaded at Lajord, SK (LGX)
- Shipment period: 11/20/2025 – 12/5/2025

### Truck Tickets (Traction Ag CSV)
- 52 loads shipped from Ogema, Lewvan, and Balcarres → LGX
- All tagged as "Hauling Inventory Transfer" to "LGX Terminals Ltd: Durum"
- All tagged to contract "JGL Commodities: 30040"
- LGX ticket numbers: 1134, 1135, 1137-1189, 1221-1222
- Dates: Oct 31 – Dec 16, 2025
- Operators: Mike Fellner, Arin Meszaros, Gurpreet Singh, Blair Hardy, Wayne Baumgartner, Jordan Lagler, Andre Pretorius, Travis Dreger, Lorne Johnston

### Settlement (JGL PDF, extracted via Claude Vision)
- Settlement #: 81025, dated 1/2/2026
- 25 rail car tickets (#5779-5803), all dated 12/18/2025
- Vehicle IDs: UCRY5475, KCS287059, SOO124057, CP652447, etc. (rail car numbers)
- Gross applied: 2,529.830 MT
- Shrink/dockage: 9.582 MT
- Net settled: 2,520.248 MT
- Gross value: $703,779.35
- Checkoff levy: $2,520.26
- **Net settlement: $701,259.09**

### The Reconciliation Gap
| Metric | Truck Tickets (to LGX) | Settlement (from JGL) | Notes |
|--------|----------------------|----------------------|-------|
| Load count | 52 | 25 | Pooled into rail cars |
| Ticket #s | 1134-1222 (LGX) | 5779-5803 (JGL rail) | Different systems |
| Total weight | ~2,275 MT (field) | 2,520.248 MT (graded) | Weight gain after grading* |
| Contract | 30040 | 30040 | Match ✓ |
| Commodity | Durum Wheat | C204 Durum | Match ✓ |

*Note: Truck tickets show field-weight (before cleaning). Settlement shows official graded weight at destination. Variance is normal and expected for LGX operations.

---

## Proposed Solution: LGX Tonnage Reconciliation Mode

### Core Concept

When reconciliation detects an LGX-routed contract, switch from **ticket-level matching** to **contract-level tonnage matching**:

1. **Detect LGX routing** — Truck tickets for the contract have destination containing "LGX"
2. **Aggregate comparison** — Sum all truck tickets vs sum all settlement lines for that contract
3. **Present tonnage summary** — Show shipped vs settled with variance
4. **Bulk approval** — Mark all truck tickets as settled, create deliveries from settlement lines

### Detection Logic

A settlement is LGX-routed when:
- The settlement's contract number matches truck tickets where `destination` contains "LGX" (from Traction Ag CSV)
- OR the settlement's counterparty has a contract with `delivery_point` = "Lajord" or "LGX"
- OR (future) `InventoryLocation.is_terminal = true` flag on LGX

In the Traction Ag CSV, the "To" column shows "LGX Terminals Ltd: Durum" — this is the reliable signal.

### Reconciliation Algorithm (New Mode)

```
function reconcileLgxTonnage(settlement, tickets):
  for each contract in settlement.contracts:
    lgxTickets = tickets.filter(t =>
      t.contract == contract.number &&
      t.destination.includes('LGX')
    )

    if lgxTickets.length == 0:
      continue  // not LGX-routed, use normal matching

    // Aggregate comparison
    shippedMt = sum(lgxTickets.map(t => t.net_weight_mt))
    settledMt = sum(settlementLines.filter(l => l.contract == contract.number).map(l => l.net_weight_mt))
    varianceMt = settledMt - shippedMt
    variancePct = (varianceMt / shippedMt) * 100

    // Mark all lines as tonnage-matched
    for each line in settlementLines.filter(l => l.contract == contract.number):
      line.match_status = 'tonnage_matched'
      line.match_mode = 'lgx_tonnage'
      line.match_confidence = calculateTonnageConfidence(variancePct)

    // Link all truck tickets to this settlement (many-to-many)
    for each ticket in lgxTickets:
      ticket.lgx_settlement_id = settlement.id
      ticket.match_mode = 'lgx_tonnage'
```

### Confidence Scoring for Tonnage Match

| Variance | Confidence | Status |
|----------|-----------|--------|
| ≤ 2% | 0.95 | Auto-match (excellent) |
| 2-5% | 0.85 | Auto-match (good — normal grading variance) |
| 5-15% | 0.70 | Flag for review (possible issue) |
| 15-25% | 0.50 | Exception (likely missing loads or data error) |
| > 25% | 0.30 | Exception (investigate) |

Note: For LGX, we expect the settled weight to often be HIGHER than shipped weight because:
- Truck tickets = field weight (before cleaning, may be estimated)
- Settlement = official graded weight at destination (after dockage applied but before shrink deducted)

### Approval Side Effects (LGX Mode)

When admin approves an LGX tonnage reconciliation:

1. **Mark all truck tickets settled** — `delivery_ticket.settled = true` for all LGX tickets on that contract
2. **Create Delivery records from settlement lines** — Use the 25 rail car lines (not 52 truck loads) since those are the official weights/grades
3. **Update MarketingContract** — Same as normal: recalc delivered_mt, update status
4. **Generate CashFlowEntry** — Same as normal: receipt based on settlement amount
5. **Store reconciliation report** — Include LGX-specific data: truck count, rail car count, tonnage variance, source locations

---

## Schema Changes

### Option A: Minimal (add fields to existing models)

```prisma
model SettlementLine {
  // ... existing fields ...
  match_mode        String?   // 'ticket' (default) | 'lgx_tonnage'
}

model DeliveryTicket {
  // ... existing fields ...
  lgx_settlement_id String?   // links truck ticket to settlement for LGX tonnage match
  lgx_settlement    Settlement? @relation("LgxTickets", fields: [lgx_settlement_id], references: [id])
}

model Settlement {
  // ... existing fields ...
  lgx_tickets       DeliveryTicket[] @relation("LgxTickets")
}

model InventoryLocation {
  // ... existing fields ...
  is_terminal       Boolean   @default(false)  // true for LGX
}
```

### Option B: Dedicated join table (more flexible)

```prisma
model LgxTonnageMatch {
  id                String    @id @default(uuid())
  settlement_id     String
  contract_number   String
  shipped_mt        Float     // sum of truck tickets
  settled_mt        Float     // sum of settlement lines
  variance_mt       Float
  variance_pct      Float
  confidence        Float
  status            String    // 'pending' | 'approved' | 'exception'
  approved_by       String?
  approved_at       DateTime?
  created_at        DateTime  @default(now())

  settlement        Settlement @relation(fields: [settlement_id], references: [id])
  truck_tickets     DeliveryTicket[] @relation("LgxTonnageTickets")
}
```

**Recommendation:** Start with Option A. It's simpler and uses the existing reconciliation flow with a mode flag. Option B is overkill unless LGX reconciliation needs its own approval workflow separate from settlement approval.

---

## Frontend Changes

### SettlementReconciliation.jsx — New LGX Panel

When LGX routing is detected, show a **Tonnage Reconciliation** panel instead of (or above) the line-by-line matching:

```
┌─────────────────────────────────────────────────────────┐
│ 🚂 LGX Tonnage Reconciliation — Contract #30040        │
│                                                         │
│ ┌──────────────┬──────────────┬──────────────┐          │
│ │ Shipped      │ Settled      │ Variance     │          │
│ │ 52 loads     │ 25 rail cars │              │          │
│ │ 2,275.5 MT   │ 2,520.2 MT   │ +244.7 MT    │          │
│ │ (field wt)   │ (graded wt)  │ (+10.7%)     │          │
│ └──────────────┴──────────────┴──────────────┘          │
│                                                         │
│ Contract: JGL #30040 ✓  Commodity: Durum ✓              │
│ Net Settlement: $701,259.09                             │
│                                                         │
│ Source Locations:                                        │
│   Lewvan  — 22 loads, ~950 MT                           │
│   Balcarres — 28 loads, ~1,230 MT                       │
│   Ogema   — 2 loads, ~81 MT                             │
│                                                         │
│ [View Truck Tickets]  [View Rail Cars]  [✓ Approve]     │
└─────────────────────────────────────────────────────────┘
```

Expandable sections:
- **Truck Tickets table**: All 52 loads with date, operator, source bin, LGX ticket #, weight
- **Rail Cars table**: All 25 settlement lines with JGL ticket #, vehicle ID, grade details, weight, price

---

## Open Questions (for user conversations)

### 1. Weight Variance — What's Normal for LGX?
In the #30040 example, truck tickets total ~2,275 MT but JGL settled 2,520 MT (+10.7%). This is likely because many truck entries are estimated transfer quantities (no gross/tare), while the settlement uses official rail car scale weights.
- Does the settlement weight always come in higher, or can it go the other way?
- What variance range is "normal" vs worth investigating? Is 10% typical?
- Could LGX ever add grain from its own stock to top up a rail car, causing a legitimately large variance?

### 2. Excluding or Reassigning Truck Loads
The plan sums all truck tickets tagged to a contract with destination "LGX" in Traction Ag. This assumes the contract tag is always correct.
- How reliable is Jessica's contract tagging in Traction Ag? Do loads ever get mis-tagged to the wrong contract?
- Would you need the ability to move individual truck loads in/out of the aggregate before approving, or is fixing it in Traction Ag and re-importing sufficient?
- Are there ever loads to LGX that aren't tied to any contract (pre-positioning grain before a deal is signed)?

### 3. Partial Settlements — Multiple PDFs per Contract
JGL #30040 was settled in one PDF (all 25 rail cars). But it might not always work that way.
- Can a buyer settle one contract across multiple settlement PDFs? e.g., first settlement covers 15 rail cars, second covers the remaining 10 a few weeks later?
- If so, should the system track a running total (shipped X MT → settled Y MT so far → Z MT remaining)?
- Should truck tickets be marked settled incrementally as each partial settlement arrives, or only when the full contract is accounted for?

### 4. Multiple Contracts to Same Buyer via LGX
C2 could have multiple active contracts with JGL for Durum flowing through LGX at overlapping times.
- Does this happen? e.g., JGL #30040 (2,500 MT Durum) and JGL #30045 (1,000 MT Durum) both shipping through LGX in the same month?
- If so, is the Traction Ag contract tag the only way to distinguish which loads belong to which, or is it also by timing/location?
- Does JGL's settlement always reference the specific contract number per rail car, or could one settlement cover multiple contracts?

### 5. Mixed Routing — Same Contract, Different Delivery Methods
JGL #30040 says "Rail Lajord" — meaning everything goes through LGX.
- Could a single contract ever have some loads delivered directly to the buyer's elevator (normal ticket matching) AND some loads through LGX (tonnage matching)?
- Or is the delivery method always contract-wide — "Rail Lajord" means 100% through LGX?

### 6. Blending Across Contracts at LGX
Grain from multiple truck loads is pooled at LGX before loading rail cars.
- Is grain segregated by contract at LGX, or could a single rail car contain grain from multiple contracts?
- Does JGL ever split a rail car across contracts on their settlement, or is each car always one contract?
- If cross-contract blending never happens, we can keep it simple (one contract at a time).

### 7. Detecting LGX Contracts — How Explicit Is It?
The JGL #30040 contract says "Ship Mode: Rail" and "Title Passes: Lajord Saskatchewan."
- Is "Rail + Lajord" always how LGX contracts are identified? Is that synonymous with "goes through LGX"?
- Are there contracts that go through LGX but aren't marked "Rail Lajord"?
- Would a "Delivery via LGX: Yes/No" flag on the contract in our system be useful, or is detecting from ticket destinations sufficient?
- Is LGX the only terminal C2 uses, or might there be others in the future?

### 8. Recon Gap Report — LGX False Alarms
The gap report's "Shipped, No Settlement" section will show all 52 LGX truck tickets as unmatched, since they'll never match rail car ticket numbers individually. This creates noise.
- Once tonnage-matched, should LGX tickets disappear from "Shipped, No Settlement" entirely, or move to a separate "LGX Tonnage Matched" section?
- Would an LGX summary line in the gap report be useful? e.g., "Contract #30040: 52 loads → LGX → 25 rail cars → Settled $701K, variance +10.7%"

---

## Implementation Phases

### Phase 1: Detection + Read-Only Summary
- Detect LGX routing from ticket destinations
- Show tonnage summary panel on SettlementReconciliation page
- No matching changes — just informational

### Phase 2: Tonnage Reconciliation Engine
- Add `match_mode` to SettlementLine
- Implement `reconcileLgxTonnage()` in reconciliationAiService.js
- Bulk link truck tickets to settlement
- Tonnage confidence scoring

### Phase 3: Approval Flow
- LGX-aware approval in settlementService.js
- Bulk mark truck tickets as settled
- Create Delivery records from settlement lines
- Update contract status and cash flow

### Phase 4: Recon Gap Report Integration
- Suppress LGX tickets from "Shipped, No Settlement" when tonnage-matched
- Add "LGX Tonnage Summary" section to gap report
- Show contracts reconciled via tonnage mode

---

## Reference Documents
- Contract PDF: `2. Marketing-Inventory/c2farmsinventory/contracts/JGL Commodities Contract# 30040 2500mt 2025 crop Durum.pdf`
- Truck tickets CSV: `2. Marketing-Inventory/c2farmsinventory/Tickets/30040 tickets.csv`
- Settlement PDF: `2. Marketing-Inventory/c2farmsinventory/all settlements/1-8-2026 JGL $701,259.09 2,520.248mt 2025 crop RSW ct#30040 st#81025.pdf`
