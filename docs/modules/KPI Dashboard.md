# KPI Dashboard

> **Status**: `Complete`
> **Priority**: `High`
> **Owner**:
> **Last Updated**: 2026-02-28

---

## Problem Statement

Farm owners and managers are drowning in numbers — 12 months × dozens of categories × two views (per-unit and accounting). They need a single screen that answers: "How is my farm performing right now?" without digging through grids. The lender asking "are you on budget?" and the farmer wondering "is this crop yielding?" need immediate, visual answers.

---

## Core Function

An at-a-glance performance dashboard showing key performance indicators as cards and gauges, crop-level yield comparisons, and a budget vs forecast bar chart. Aggregates data from assumptions, financial, and operational modules into a single executive view.

---

## Who Uses This

| Role | Goal |
|------|------|
| Farm owner / admin | Quick health check on farm performance, lender-ready snapshot |
| Farm manager | Identify where attention is needed — which costs are off track |
| Viewer / advisor | Assess overall farm health without navigating detailed grids |

---

## Enterprise Workflow

This is a **consumption-only view** — no data entry happens here:

1. User navigates to the dashboard and immediately sees the current state
2. KPI cards show: Yield vs Target %, Inputs Adherence %, Expense/Acre, Labour Cost/Acre, Total Expenses, Inputs Total
3. Gauge charts give visual red/yellow/green indicators for percentage-based KPIs
4. Crop yield cards show each crop's actual vs target yield with a percentage
5. Budget vs Forecast chart shows the four expense categories side by side
6. The farmer uses this to decide where to focus — "Inputs at 112% of budget, need to investigate Chemical spend"

This is often the screen shown to the **lender, accountant, or board** during reviews.

---

## Interconnections

### Feeds Into
- [[AI Assistant]] — dashboard KPIs could trigger AI-generated insights

### Receives From
- [[Yield & Assumptions]] — crop targets, total acres, yield data
- [[Cost Forecast]] — expense totals by category
- [[Per-Unit Analysis]] — per-acre metrics
- [[Operational Data]] — labour hours for labour cost/acre calculation

### Impacts
- No downstream modules — this is an output/reporting layer

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| None | Pure aggregation of internal data | — |

---

## Key Business Rules

- All KPIs are calculated at query time from live data — never stored
- Yield vs Target % = actual yield ÷ target yield from assumptions crops
- Inputs Adherence % = actual inputs spend ÷ budgeted inputs spend
- Expense/Acre = total expenses ÷ total acres
- Budget vs Forecast chart groups by: Inputs, LPM, LBF, Insurance
- If no frozen budget exists, variance-based KPIs show as N/A

---

## Open Questions

- Should we add trend lines (month-over-month KPI progression)?
- Would a "alerts" system make sense here — flagging KPIs that cross thresholds?
- Should crop yield actuals come from assumptions or from a separate yield tracking module?

---

## Notes & Sub-Topics

- KPI calculation methodology
- Gauge chart threshold configuration
- Export dashboard as PDF snapshot

---

## Related Notes

- [[Yield & Assumptions]]
- [[Cost Forecast]]
- [[Per-Unit Analysis]]
- [[Operational Data]]
- [[AI Assistant]]
