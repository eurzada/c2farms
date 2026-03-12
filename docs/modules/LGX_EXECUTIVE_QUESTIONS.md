# LGX Terminal — Executive Questions

## Purpose

This document captures the strategic questions we need to resolve with C2 Farms leadership before designing how LGX fits into the platform. The answers will determine whether LGX is treated as a simple pass-through location, a standalone business unit, or something in between.

Today LGX exists in the system as an inventory location (`cluster_type: 'transit'`). The tonnage reconciliation problem (truck tickets vs rail car settlements) is already documented in `LGX_RECONCILIATION.md`. These questions go one level up: how should LGX operate as a business within C2 Farms, and what does that mean for the platform?

---

## 1. Business Unit Status

LGX currently has no P&L, no budget, and no financial reporting of its own. It is just a physical location where grain passes through.

- **Should LGX be its own business unit with a separate P&L?** The other six locations (Balcarres, Hyas, Lewvan, Stockholm, Provost, Ridgedale, Ogema) each have their own forecast budgets, expense tracking, and profitability reporting. Does LGX need the same?
- **What revenue does LGX generate?** Is the revenue simply the spread between what C2 pays growers (or transfers internally) and what the end buyer pays for blended product? Or are there terminal fees, handling charges, storage fees?
- **What are LGX's operating costs?** Labour, rail car leasing, equipment, power, property — are these currently tracked somewhere (QuickBooks GL code, separate entity, lumped into a BU)?
- **Is LGX a separate legal entity?** The Traction Ag data references "LGX Terminals Ltd" — is that a distinct corporation from C2 Farms Ltd? If so, does it file separate financials?

### Why This Matters
If LGX is its own BU, it needs a farm record in the system with its own categories, budget, actuals, and GL mapping — the same infrastructure every other BU has. If it is not, we just need to handle the grain-flow tracking without financial reporting.

---

## 2. Contracts and Settlements — Internal Documentation

When C2 Farms ships grain from Lewvan to Richardson at a buyer elevator, Richardson issues a contract and settlement back to C2. The documentation flow is clean: contract in, grain out, settlement back, payment received.

When C2 ships grain from Lewvan to LGX, there is currently no equivalent documentation.

- **Does LGX issue contracts to C2 Farms (or to the individual BU locations) for grain received?** For example: "LGX will purchase 2,500 MT of Durum from Lewvan at $X/MT."
- **Does LGX issue settlements back to C2 Farms for grain it has received and sold forward?** Or does C2 simply treat the JGL settlement (the end buyer) as the settlement for the original shipment?
- **How is the internal transfer price determined?** Is it the end-buyer contract price minus a terminal margin? A fixed handling fee? The same price as the end-buyer contract (no LGX margin)?
- **Is there any paper trail today for grain moving from a BU to LGX?** Or is the Traction Ag ticket the only record?

### Why This Matters
If LGX issues its own contracts and settlements to C2 BUs, then in the system LGX looks like any other buyer — BU ships grain, LGX settles it, and separately LGX ships to JGL and JGL settles with LGX. Two hops, two sets of documentation, clean reconciliation at each hop. If there is no internal documentation, we need to build the pass-through logic that connects BU shipments directly to end-buyer settlements across the LGX gap.

---

## 3. Third-Party Producers

The roadmap notes mention that third-party producers also ship grain to LGX. This introduces a fundamentally different relationship: LGX is not just a C2 internal terminal, it is also acting as an elevator/handler for outside parties.

- **How many third-party producers currently ship to LGX?** Is this a handful of neighbours or a significant volume?
- **What documentation does LGX provide to third-party producers?** Contracts? Settlement statements? Payment receipts?
- **How are third-party producers paid?** Does LGX pay them directly, or does C2 Farms pay them? At what price — a pre-agreed contract price, or a share of what the end buyer paid?
- **Is third-party grain blended with C2 grain?** If so, how is the contribution tracked (by weight, by grade, by contract)?
- **Are there any regulatory requirements?** Licensed grain dealer obligations, bonding, CGC reporting?

### Why This Matters
If LGX handles third-party grain, then LGX absolutely needs its own accounts payable (grower settlements), accounts receivable (buyer settlements), and inventory tracking (whose grain is in which pile). This is a full grain-handling business, not just an internal transfer point.

---

## 4. Grain Flow and Inventory Tracking

Understanding the physical flow is essential for designing the data model.

- **Inbound**: When grain arrives at LGX from a C2 location, is it weighed in on an LGX scale? Or does LGX rely on the origin weigh-scale ticket?
- **Storage**: Is grain stored in distinct bins/piles by commodity, grade, crop year, and source? Or is everything pooled by commodity immediately?
- **Blending**: How are blending decisions made? Is there a recipe (e.g., 60% #1 Durum + 40% #2 Durum = milling quality)? Who decides, and is it documented?
- **Outbound**: When rail cars are loaded, is each car weighed at LGX or at the rail facility? How is the loaded weight recorded?
- **Shrink and loss**: Is there an expected shrink rate for grain passing through LGX (handling loss, cleaning, drying)? How is this currently accounted for?
- **How long does grain sit at LGX?** Days (pure throughput) or weeks/months (storage and positioning)?

### Why This Matters
If LGX is a quick pass-through (grain in one week, rail cars out the next), inventory tracking can be simple — just tonnage in vs tonnage out per contract. If grain sits for extended periods and is blended across contracts and sources, we need full bin-level inventory management at LGX with perpetual position tracking.

---

## 5. Financial Tracking and Cost Allocation

- **Where do LGX operating costs currently land in the books?** Under a specific GL code? Spread across BUs? In a separate QuickBooks entity?
- **Is there a handling/throughput fee charged internally?** e.g., $5/MT for all grain passing through LGX, allocated back to the originating BU?
- **Rail freight**: Who pays — LGX, the originating BU, or the end buyer? Is it deducted from the settlement or paid separately?
- **Who bears the weight variance risk?** When truck tickets say 2,275 MT and the settlement says 2,520 MT, the gain accrues to someone. When the reverse happens (shrink), someone absorbs the loss. Which entity?
- **How should LGX profitability be reported?** Per contract? Per month? Per commodity? Or is a simple annual summary sufficient?

### Why This Matters
Cost allocation determines whether LGX is a profit centre or a cost centre in the system. It also affects how BU-level profitability is calculated — if LGX handling costs are not allocated back, BU margins are overstated for any grain routed through LGX.

---

## 6. Relationship to Marketing Contracts

Currently, marketing contracts in the system are enterprise-wide. A JGL Durum contract might be fulfilled from any combination of locations.

- **Are LGX-routed contracts distinct from direct-ship contracts at the time of signing?** Or is the routing decision made later?
- **Does the buyer (e.g., JGL) know or care that grain comes through LGX?** Or is LGX transparent to the buyer — they just see "C2 Farms, loaded at Lajord"?
- **Can a marketing contract change routing mid-execution?** e.g., Start shipping direct to elevator, then switch to LGX routing for the remaining tonnes?
- **Should LGX have its own marketing contracts (buying from C2 BUs, selling to end buyers)?** Or should it remain invisible in the marketing module?

### Why This Matters
If LGX has its own buy/sell contracts, the marketing module needs to support two-leg trades: C2 BU sells to LGX (internal), LGX sells to end buyer (external). If LGX is transparent, then the current single-contract model works, but reconciliation must bridge the LGX gap.

---

## 7. Future Scale and Scope

- **Is LGX volume expected to grow?** What percentage of total C2 production currently flows through LGX vs direct-to-buyer?
- **Will LGX handle more commodities?** Currently we see Durum. Will it also handle Canola, Lentils, Chickpeas?
- **Are there plans for additional terminals beyond LGX?** If so, whatever we build should be generic "terminal" logic, not LGX-specific.
- **Could LGX become a standalone product?** i.e., Could other farming operations use a C2-Farms-style terminal management module for their own inland terminals?

### Why This Matters
If LGX is a small, stable operation handling one or two commodities, we can build a lightweight solution. If it is growing and may be replicated, we need to design a general-purpose terminal module from the start.

---

## Summary: The Core Decision

The answers to these questions will land LGX in one of three architectural tiers:

| Tier | Description | System Impact |
|------|-------------|---------------|
| **Pass-through** | LGX is just a waypoint. No internal contracts, no P&L, no third-party handling. | Tonnage reconciliation only (already planned). Minimal new infrastructure. |
| **Cost centre** | LGX has operating costs that need tracking and allocation, but no independent revenue or contracts. | Add LGX cost tracking to financials. Allocate costs back to BUs. No new contract flows. |
| **Business unit** | LGX is a full grain-handling operation with its own contracts (buy from BUs/third parties, sell to buyers), P&L, and inventory. | New BU farm record, internal contract model, grower payables, full terminal inventory, separate financial reporting. |

The tier determines how much we build, and whether we build it as LGX-specific logic or as a reusable terminal module.
