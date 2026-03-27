# LGX Terminal — User Instructions (Three Scenarios)

> **Updated**: 2026-03-26
> **Supersedes**: Previous transfer agreement workflow

This guide walks through three LGX scenarios based on grain ownership:
- **Scenario A**: 100% C2 Farms grain
- **Scenario B**: Mixed (50% C2 / 50% third-party)
- **Scenario C**: 100% third-party grain

Each scenario uses JGL as the example buyer and real-world reference data.

---

## Key Concept: Two Separate Transactions

For C2 grain routed through LGX, there are always **two independent transactions**:

| # | Transaction | Parties | What happens |
|---|-------------|---------|-------------|
| 1 | **Grain sale** | C2 Farms --> Buyer | Buyer pays C2 for the grain (MarketingContract) |
| 2 | **Transloading fee** | LGX --> Buyer | LGX invoices buyer for receiving, blending, and shipping (service fee) |

LGX **never owns** C2 grain. LGX is a service provider.

For third-party grain, LGX **does** act as intermediary (buys from grower, sells to buyer).

---

## Scenario A: 100% C2 Farms Grain

> **Example**: JGL Contract #30040 — 2,500 MT Durum #2
> C2 ships from Ogema (#3), Lewvan (#4), Balcarres (#1) to LGX, who blends to grade #2 and ships via rail to JGL.

### Step 1: Create the Marketing Contract (Enterprise level)

**Who**: Admin / Marketing Manager
**Where**: Marketing --> Contracts (Enterprise farm selected)

1. Click **New Contract**
2. Fill in:
   - Counterparty: **JGL**
   - Commodity: **Durum**
   - Contract #: **30040**
   - Contracted MT: **2,500**
   - Price: **$279.25/MT**
   - Delivery method: **Terminal** (this is the key field)
   - Terminal: **LGX**
3. Add **Grade Prices** (used later for BU credit allocation):
   - Durum #1: $288/MT
   - Durum #3: $240/MT
   - Durum #4: $200/MT
4. Save. The contract appears with an "LGX" badge in the contracts list.

### Step 2: Create the Transloading Agreement (LGX level)

**Who**: LGX Manager
**Where**: LGX --> Contracts

1. Click **New Contract**
2. Set Contract Type: **Transloading Agreement**
3. Fill in:
   - Counterparty: **JGL**
   - Commodity: **Durum**
   - Contracted MT: **2,500**
   - Transloading Rate: **$12/MT** (or whatever JGL pays for the service)
   - Linked Marketing Contract: **#30040** (auto-links the two)
4. Save. This is LGX's revenue contract — completely separate from the grain sale.

### Step 3: Ship grain from BU farms to LGX

**Who**: Logistics Manager
**Where**: Traction Ag (truck tickets) + LGX --> Incoming

1. BU farms ship grain to LGX via truck:
   - Balcarres: 800 MT Durum #1 (18 loads)
   - Ogema: 700 MT Durum #3 (15 loads)
   - Lewvan: 1,020 MT Durum #4 (19 loads)
2. **Traction Ag** records DeliveryTickets (#4501-4552) at the farm weigh scales
3. **LGX** records TerminalTickets (#1134-1186) at the LGX receiving scale
4. On each LGX inbound ticket:
   - `is_c2_farms` = **Yes** (auto-detected from grower name)
   - `marketing_contract_id` = linked to **#30040**
   - `inventory_stage` = **raw_material**
5. Grain goes into LGX bins sorted by grade

### Step 4: Blend and load rail cars

**Who**: LGX Manager
**Where**: LGX --> Blending, then LGX --> Outgoing

1. **Blending**: LGX creates blend events to hit Durum #2 target
   - Source bin (e.g., Bin 3 with #1 grain) + Blend bin (e.g., Bin 5 with #3 grain)
   - Target protein / grade specification from Cotecna
   - Link blend event to Marketing Contract #30040
   - Inventory stage: **wip**
2. **Outgoing**: Load rail cars from blended inventory
   - Create outbound TerminalTickets (#5779-5803) — 25 rail cars
   - Record rail car numbers, seal numbers, weights
   - Link to Marketing Contract #30040
   - Inventory stage: **finished_goods**
3. Rail cars shipped to JGL --> inventory stage: **shipped**

### Step 5: JGL settles with C2 Farms (grain payment)

**Who**: Admin
**Where**: LGX --> Settlements (or Logistics --> Settlements)

1. JGL sends settlement PDF (e.g., settlement #81025, $701,259.09 net)
2. Upload via **LGX --> Grain Sale --> Upload PDF**
   - The system auto-detects contract #30040 has `delivery_method: terminal`
   - Creates an **enterprise Settlement** (not a TerminalSettlement)
   - Extracts 25 rail car lines automatically
3. Click **Reconcile Tonnage** to open the three-layer reconciliation dialog:
   ```
   Layer 1: C2 Shipped (52 trucks, ~2,520 MT)
        --> LGX Inbound (52 tickets, ~2,520 MT)
   Layer 2: LGX Outbound (25 rail cars, ~2,520 MT)
        --> JGL Settled (25 lines, 2,520.248 MT)
   Layer 3: Overall variance: ~0% (within normal range)
   ```
4. Review the **BU Farm Contributions** table:
   - Balcarres: 800 MT (31.7%)
   - Ogema: 700 MT (27.8%)
   - Lewvan: 1,020 MT (40.5%)
5. Click **Approve & Allocate BU Credits**
6. System automatically:
   - Approves the settlement
   - Updates MarketingContract #30040 to `fulfilled`
   - Creates **BU credit allocations** (grade-adjusted):
     - Balcarres: 800 MT x ($288/$247.72) x $278.28/MT = **$323,519**
     - Ogema: 700 MT x ($240/$247.72) x $278.28/MT = **$188,756**
     - Lewvan: 1,020 MT x ($200/$247.72) x $278.28/MT = **$188,984**
     - Total = **$701,259**
   - Creates CashFlowEntry for the receipt

### Step 6: LGX invoices JGL for transloading (service fee)

**Who**: LGX Manager
**Where**: LGX --> Contracts --> (select transloading agreement)

1. Open the Transloading Agreement for JGL/#30040
2. Click **Generate Transloading Settlement**
   - System sums outbound tickets: 25 rail cars, ~2,520 MT
   - Applies rate: 2,520 MT x $12/MT = **$30,240**
   - Creates TerminalSettlement type `transloading` in draft
3. Review the settlement, then **Finalize**
4. Click **Download Invoice** to generate PDF for JGL
5. This is **LGX BU revenue** — completely independent of the grain payment

### What each person sees at the end

| Role | What they see |
|------|--------------|
| **Marketing** | Contract #30040 fulfilled, $701K received from JGL |
| **LGX Manager** | Transloading invoice sent, $30K revenue for LGX |
| **Balcarres BU** | BU credit: $323K for 800 MT Durum #1 |
| **Ogema BU** | BU credit: $189K for 700 MT Durum #3 |
| **Lewvan BU** | BU credit: $189K for 1,020 MT Durum #4 |
| **Accountant** | Export BU Credit Allocation report + Transloading P&L |

---

## Scenario B: Mixed — 50% C2 / 50% Third-Party Grain

> **Example**: JGL Contract #40050 — 1,000 MT Wheat CWRS #2
> C2 ships 500 MT from Hyas. A third-party grower (Smith Farms) ships 500 MT directly to LGX.

This scenario uses **both** the three-party model (for C2 grain) and the intermediary model (for third-party grain).

### Step 1: Create two contracts

**Contract A — C2 grain sale to JGL** (Enterprise level):
- Marketing --> Contracts --> New Contract
- Counterparty: JGL, Commodity: Wheat, Contract #: 40050-C2
- Contracted MT: **500** (C2's portion only)
- Delivery method: **Terminal**, Terminal: **LGX**
- Grade prices: CWRS #1 $320/MT, #2 $310/MT, #3 $290/MT

**Contract B — LGX buys from Smith Farms** (LGX level):
- LGX --> Contracts --> New Contract
- Contract Type: **Grain Trade** (not transloading)
- Direction: **Purchase**
- Counterparty: Smith Farms, Commodity: Wheat
- Contracted MT: **500**, Price: $300/MT

**Contract C — LGX sells blended product to JGL** (LGX level):
- LGX --> Contracts --> New Contract
- Contract Type: **Grain Trade**
- Direction: **Sale**
- Counterparty: JGL, Commodity: Wheat
- Contracted MT: **500** (LGX's portion)
- Price: $310/MT

**Contract D — Transloading agreement** (LGX level):
- LGX --> Contracts --> New Contract
- Contract Type: **Transloading Agreement**
- Counterparty: JGL
- Contracted MT: **1,000** (full volume including both portions)
- Transloading Rate: $12/MT
- Linked MC: #40050-C2

### Step 2: Receive grain at LGX

**C2 grain** (500 MT from Hyas):
- Inbound tickets with `is_c2_farms = Yes`
- Linked to Marketing Contract #40050-C2
- Inventory stage: raw_material

**Third-party grain** (500 MT from Smith Farms):
- Inbound tickets with `is_c2_farms = No`
- Linked to TerminalContract (Purchase from Smith)
- Inventory stage: raw_material

### Step 3: Blend and ship (same as Scenario A)

- LGX blends both sources to hit CWRS #2 target
- 25 outbound rail car tickets, total ~1,000 MT
- C2-linked outbound tickets → linked to MC #40050-C2
- Smith-linked outbound tickets → linked to TerminalContract (Sale to JGL)

### Step 4: JGL settles

JGL may send **one combined settlement** or **two separate ones**. Either way:

**For the C2 portion** (500 MT):
1. Upload settlement PDF via **LGX --> Grain Sale --> Upload PDF**
2. System detects terminal-routed contract #40050-C2
3. Tonnage reconciliation → Approve → BU credits to Hyas
4. **Three-party flow** applies

**For the third-party portion** (500 MT):
1. Upload settlement PDF via **LGX --> Settlements --> Upload Buyer PDF**
2. System links to TerminalContract (Sale to JGL)
3. Standard **buyer settlement reconciliation** (ticket-level matching)
4. **Compute Realization**: LGX sold at $310/MT, bought at $300/MT → margin $10/MT x 500 = **$5,000**
5. Push to logistics → LGX captures the margin

### Step 5: LGX transloading fee

- Generate transloading settlement for the full 1,000 MT
- 1,000 MT x $12/MT = **$12,000** invoiced to JGL
- Covers both C2 and third-party grain handling

### Summary

| Item | C2 Portion (500 MT) | Third-Party Portion (500 MT) |
|------|---------------------|------------------------------|
| **Who owns the grain** | C2 Farms | LGX (bought from Smith) |
| **Who JGL pays for grain** | C2 Farms | LGX |
| **Contract type** | MarketingContract (enterprise) | TerminalContract (purchase + sale) |
| **Settlement flow** | Enterprise Settlement → tonnage recon → BU credits | TerminalSettlement → buyer recon → realization margin |
| **LGX margin on grain** | None (service only) | $10/MT = $5,000 |
| **Transloading fee** | $12/MT = $6,000 | $12/MT = $6,000 |
| **Hyas credit** | $155,000 (grade-adjusted) | N/A |

---

## Scenario C: 100% Third-Party Grain

> **Example**: Richardson Contract #55010 — 800 MT Canola
> LGX buys 800 MT from two local growers (Johnson Farms 500 MT, Peters Ag 300 MT), blends, and sells to Richardson.

In this scenario, **LGX is the intermediary**. C2 Farms is not involved in the grain transaction. This uses the legacy flow.

### Step 1: Create purchase contracts (LGX level)

**Purchase from Johnson Farms**:
- LGX --> Contracts --> New Contract
- Contract Type: **Grain Trade**, Direction: **Purchase**
- Counterparty: Johnson Farms, Commodity: Canola
- Contracted MT: **500**, Price: $600/MT

**Purchase from Peters Ag**:
- LGX --> Contracts --> New Contract
- Contract Type: **Grain Trade**, Direction: **Purchase**
- Counterparty: Peters Ag, Commodity: Canola
- Contracted MT: **300**, Price: $595/MT

### Step 2: Create sale contract (LGX level)

- LGX --> Contracts --> New Contract
- Contract Type: **Grain Trade**, Direction: **Sale**
- Counterparty: Richardson, Commodity: Canola
- Contracted MT: **800**, Price: $620/MT

### Step 3: Receive grain at LGX

- Inbound tickets from Johnson (500 MT) and Peters (300 MT)
- `is_c2_farms = No` on all tickets
- Linked to respective purchase contracts
- Inventory stage: raw_material

### Step 4: Blend and ship

- LGX blends as needed, loads rail cars
- Outbound tickets linked to Sale contract (Richardson)
- Inventory stage: finished_goods --> shipped

### Step 5: Pay the growers (transfer settlements)

**Johnson Farms**:
1. LGX --> Settlements --> Create Settlement
2. Type: **Transfer**, Counterparty: Johnson Farms
3. Link to purchase contract, select inbound tickets
4. Apply pricing: 500 MT x $600/MT = **$300,000**
5. Finalize and push to logistics

**Peters Ag**:
1. Same flow: 300 MT x $595/MT = **$178,500**

### Step 6: Richardson settles with LGX

1. Richardson sends settlement PDF
2. Upload via **LGX --> Settlements --> Upload Buyer PDF**
3. System links to Sale contract (Richardson)
4. Standard buyer settlement reconciliation (rail car ticket matching)
5. **Compute Realization**:
   - LGX sold: 800 MT x $620/MT = $496,000
   - LGX bought: (500 x $600) + (300 x $595) = $478,500
   - **LGX margin: $17,500** ($21.88/MT)
6. Finalize and push to logistics

### Step 7: No transloading agreement needed

LGX is the grain trader here, not a service provider. The margin IS LGX's revenue. There is no separate transloading fee — LGX's profit comes from the buy/sell spread.

However, if Richardson also pays a separate handling fee, create a transloading agreement as in Scenario A.

### Summary

| Item | Value |
|------|-------|
| **Who owns the grain** | LGX (bought from growers) |
| **LGX buys at** | $600/MT (Johnson), $595/MT (Peters) |
| **LGX sells at** | $620/MT (Richardson) |
| **LGX grain margin** | $17,500 |
| **C2 BU credits** | None (no C2 grain involved) |
| **Settlement type (growers)** | transfer (LGX pays growers) |
| **Settlement type (buyer)** | buyer_settlement (Richardson pays LGX) |

---

## Quick Reference: Which Flow To Use

| Question | Answer | Flow |
|----------|--------|------|
| Is this C2 grain? | Yes | **Three-party**: MarketingContract + transloading agreement |
| Is this C2 grain? | No | **Intermediary**: TerminalContract (purchase + sale) |
| Who does the buyer pay for grain? | C2 Farms | Three-party flow |
| Who does the buyer pay for grain? | LGX | Intermediary flow |
| Does LGX earn a grain margin? | No (C2 grain) | Transloading fee only |
| Does LGX earn a grain margin? | Yes (third-party) | Buy/sell spread |
| Mixed load? | Both C2 and third-party | Split into two portions, each follows its own flow |

---

## Available Reports

| Report | Where | What it shows |
|--------|-------|--------------|
| **BU Credit Allocations** | LGX Dashboard --> Export | How buyer payments were allocated to BU farms (grade-adjusted) |
| **Transloading P&L** | LGX Dashboard --> Export | LGX transloading revenue by buyer and month |
| **Inventory Flow** | LGX Dashboard --> Export | Grain through stages (raw --> WIP --> finished --> shipped) |
| **Grain Balance** | LGX Dashboard --> Export | Current bin inventory positions |
| **Contract Fulfillment** | LGX Dashboard --> Export | Contract status and remaining tonnage |

---

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Upload PDF goes to wrong flow | Contract missing `delivery_method: terminal` | Edit MarketingContract, set delivery method to Terminal |
| BU credits not created | No inbound tickets linked to marketing contract | Link inbound TerminalTickets to the MarketingContract |
| Tonnage variance > 5% | Missing tickets or weight discrepancy | Check all truck loads were received; compare field vs LGX scale weights |
| Grade prices not applied | `grade_prices_json` empty on MarketingContract | Edit contract, add grade-level prices |
| Transloading settlement $0 | No outbound tickets linked | Link outbound TerminalTickets to the marketing contract |
| `computeRealization` error | Tried to use legacy flow on C2 grain | Use Grain Sale --> Reconcile Tonnage instead |
