# Cost Forecast

> **Status**: `Complete`
> **Priority**: `Critical`
> **Owner**:
> **Last Updated**: 2026-02-28

---

## Problem Statement

Farm managers need to track total dollar expenses month by month across the fiscal year — both what they planned to spend (budget) and what they actually spent (actuals from the books). Without a centralized view, they're reconciling between QuickBooks reports, spreadsheets, and memory. They can't see where they're over or under budget until it's too late.

---

## Core Function

A 12-month accounting grid showing total dollar values by expense category. Managers enter budget figures manually or import actuals from their GL (via CSV or QuickBooks). The grid shows budget vs actual by month, with totals and variance against the frozen budget. This is the "accounting view" — total dollars, not per-acre.

---

## Who Uses This

| Role | Goal |
|------|------|
| Farm manager | Enter monthly budget, import actuals from QB/CSV, monitor spending |
| Farm owner / admin | Review financial position, export reports for lender or accountant |
| Viewer / advisor | Review spending patterns (read-only) |

---

## Enterprise Workflow

This module is used **throughout the fiscal year** in two phases:

**Budgeting phase (pre-season):**
1. After assumptions are set, manager works through each month entering expected costs — seed purchases in spring, fuel through summer, rent payments monthly, etc.
2. Values are entered in total dollars (or can be entered in Per-Unit and auto-calculated here)
3. Once complete, the budget is frozen in Assumptions

**Tracking phase (in-season and post-season):**
1. Each month, the bookkeeper enters actuals into QuickBooks
2. Actuals are imported into C2 Farms via CSV export from QBO (or future direct sync)
3. The grid shows budget vs actual — green where on track, red where over
4. Manager uses this to make operational decisions: cut spending, re-allocate, etc.
5. At year-end, the full picture is exported as Excel or PDF for the lender, accountant, or board

---

## Interconnections

### Feeds Into
- [[Per-Unit Analysis]] — accounting values ÷ total acres = per-unit values (bidirectional sync)
- [[KPI Dashboard]] — expense totals drive KPI cards (Expense/Acre, Total Expenses, Inputs Total)
- [[Forecasting]] — budget vs actual comparison data
- [[AI Assistant]] — financial data is part of the farm context for natural language queries

### Receives From
- [[Yield & Assumptions]] — total acres for per-unit conversion; frozen budget for variance baseline
- [[Chart of Accounts]] — category hierarchy defines the rows; GL account mappings drive rollup
- [[QuickBooks Integration]] — (future) automated GL actual import
- [[Per-Unit Analysis]] — edits in per-unit auto-calculate accounting values (bidirectional)

### Impacts
- [[Per-Unit Analysis]] — every edit here recalculates the corresponding per-unit value
- [[KPI Dashboard]] — changes immediately reflect in KPI calculations

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| QuickBooks Online | Source of GL actuals | Inbound (CSV now, API future) |
| Excel / PDF | Export target for reports | Outbound |

---

## Key Business Rules

- Accounting value = per-unit value × total acres (always in sync)
- Months with imported actuals are locked (`is_actual = true`) — budget cells can't overwrite real data
- GL actuals roll up: individual GL accounts → leaf categories → parent categories → totals
- Total Expense and Profit are computed at query time, not stored
- CSV import creates GL account records and detail-level actuals, then rolls up to category totals
- Clear Year is available to wipe imported actuals and start fresh

---

## Open Questions

- Should we support partial-month actuals (e.g., actuals through the 15th, budget for the rest)?
- How should we handle GL accounts that don't map to any category?

---

## Notes & Sub-Topics

- CSV import format and validation rules
- Excel/PDF export layout and formatting
- GL rollup logic details

---

## Related Notes

- [[Yield & Assumptions]]
- [[Per-Unit Analysis]]
- [[Chart of Accounts]]
- [[KPI Dashboard]]
- [[QuickBooks Integration]]
