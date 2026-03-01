# Per-Unit Analysis

> **Status**: `Complete`
> **Priority**: `Critical`
> **Owner**:
> **Last Updated**: 2026-02-28

---

## Problem Statement

Total dollar figures are meaningful to the accountant, but the farmer thinks in **dollars per acre**. A $50,000 fuel bill means something very different on a 2,000-acre farm versus a 10,000-acre farm. Per-acre metrics are how farmers compare performance year over year, benchmark against neighbours, and make agronomic decisions. Without this view, the farmer has to manually divide every number by total acres.

---

## Core Function

A 12-month grid showing all expense categories in $/acre. This is the mirror of Cost Forecast — same data, different lens. Edits flow bidirectionally: change a per-unit value and the accounting total recalculates, and vice versa. Includes frozen budget comparison and variance columns so the farmer can see exactly where they're over or under on a per-acre basis.

---

## Who Uses This

| Role | Goal |
|------|------|
| Farm manager | Budget in $/acre (the natural unit for farm planning), track per-acre variance |
| Farm owner / admin | Compare per-acre costs year over year, benchmark against industry |
| Viewer / advisor | Analyze cost structure on a per-acre basis for lending or advisory |

---

## Enterprise Workflow

This module is the **farmer's preferred working view** for budgeting:

1. Manager opens Per-Unit and sees the 12-month grid in $/acre
2. They budget by thinking: "Seed will cost me about $28/acre in April, fertilizer $55/acre split between March and April..."
3. Each cell edit instantly recalculates the accounting (total $) equivalent
4. The frozen budget column shows what they originally planned
5. As actuals come in (via Cost Forecast / CSV import), the actual $/acre appears alongside budget
6. Variance and % difference columns highlight where reality differs from plan
7. Prior year aggregate column provides historical context

This is also the view most useful for **lender conversations** — lenders and agronomists think in per-acre terms.

---

## Interconnections

### Feeds Into
- [[Cost Forecast]] — per-unit × acres = accounting value (bidirectional sync)
- [[KPI Dashboard]] — per-acre metrics feed directly into KPI cards
- [[AI Assistant]] — per-acre data is included in farm context

### Receives From
- [[Yield & Assumptions]] — total acres for conversion; frozen budget for variance; crop mix
- [[Cost Forecast]] — actuals imported via CSV/QB flow back as per-unit values (accounting ÷ acres)
- [[Chart of Accounts]] — category hierarchy defines the rows

### Impacts
- [[Cost Forecast]] — every per-unit edit recalculates the corresponding accounting value

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| None directly | Data flows through Cost Forecast and Assumptions | Internal |

---

## Key Business Rules

- Per-unit value = accounting value ÷ total acres
- Revenue categories are excluded from this view (expense-focused)
- Parent category rows show the sum of their children
- Months with actuals are display-only (locked from manual editing)
- Prior year column aggregates the previous fiscal year's per-unit totals
- Variance = forecast total − frozen budget total

---

## Open Questions

- Should we show per-acre revenue alongside expenses for a complete per-acre P&L?
- Would a year-over-year comparison view (2025 vs 2026 side by side) be valuable?

---

## Notes & Sub-Topics

- Bidirectional calculation logic
- Frozen budget variance methodology

---

## Related Notes

- [[Cost Forecast]]
- [[Yield & Assumptions]]
- [[KPI Dashboard]]
- [[Chart of Accounts]]
