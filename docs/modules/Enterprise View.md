# Enterprise View

## Purpose

The Enterprise View is the **consolidated, executive-level view** of the entire farm operation. It appears as a 7th entry in the business unit dropdown — alongside but distinct from the 6 physical locations (Lewvan, Hyas, Waldron, Balcarres, Ridgedale, Ogema).

While individual business units show only the Financial Forecast for that location, the Enterprise View surfaces **all modules** in a single, read-mostly experience.

## Persona

- **Farm Owner / Principal Operator** — the person who needs to see the whole picture across all locations
- Decision-maker who doesn't input day-to-day data but needs to see the rollup

## Data Flow

Control centre modules handle input at the operational level:

| Module | Input At | Flows To |
|--------|----------|----------|
| Grain Marketing | Marketing control centre | Contract values → Forecast revenue |
| Grain Inventory | Inventory control centre | Bin counts → Forecast grain position |
| Agronomy | Agronomy control centre | Field plans → Forecast input costs |
| QuickBooks | QBO sync | GL actuals → Forecast actuals |

The Enterprise View **reads** these consolidated results. It is not an input screen.

## Sidebar Navigation (when Enterprise View is selected)

When a user selects the Enterprise View from the BU dropdown, the sidebar adapts to show:

- **Forecast** — P&L consolidated across all 6 locations
- **Grain Marketing** — global position, contracts, prices, cash flow, sell analysis
- **Grain Inventory** — all-location dashboard, bins, reconciliation
- **Agronomy** — whole-farm field plans, input tracking (future)
- **KPIs** — consolidated key performance indicators

## Key Dashboards / Screens

### Consolidated Forecast
- Combined P&L across all BUs (Revenue, Inputs, LPM, LBF, Insurance)
- Budget vs Actual with variance at the enterprise level
- Monthly cash flow projection (all locations)

### Global Grain Position
- Total inventory across all bins and locations
- Marketing contracts vs physical inventory
- Available-to-sell across the whole operation

### Cash Flow Overview
- Cash requirements and receipts rolled up
- LOC utilization and projections
- Upcoming contract payment dates

### Labour & Equipment
- Headcount and labour cost across locations
- Equipment allocation and utilization (future)

### Agronomic Summary (future)
- Total acres by crop across all locations
- Input cost per acre rolled up
- Yield projections vs actuals

## UX Notes

- **Read-mostly**: the Enterprise View is for viewing aggregated data, not entering it
- **Drill-down**: clicking into a consolidated number should navigate to the relevant BU or control centre for detail
- The dropdown uses a **visual divider** to separate the 6 BUs from the Enterprise View entry
- Consider a distinct icon (star, building, globe) to differentiate from location entries

## Status

**Planned** — not yet implemented. This document captures the vision for future build-out.
