# Yield & Assumptions

> **Status**: `Complete`
> **Priority**: `Critical`
> **Owner**:
> **Last Updated**: 2026-02-28

---

## Problem Statement

Before a farm can budget, forecast, or track anything, it needs a defined plan for the year — what crops are being grown, how many acres, what yields are expected, and what prices are anticipated. Without this foundation, every other financial module has no frame of reference. Today this lives in spreadsheets, scraps of paper, and the farmer's head.

---

## Core Function

Captures the farm's annual operating plan: fiscal year definition, total acreage, crop mix (acres, target yield, expected price per unit), and grain bin inventory. This is the foundational dataset that every other module references. It also manages the budget freeze — locking in a point-in-time snapshot so variance analysis has a stable baseline to compare against.

---

## Who Uses This

| Role | Goal |
|------|------|
| Farm owner / admin | Define the year's crop plan, set targets, freeze the budget |
| Farm manager | Input or update crop plan details, freeze budget |
| Viewer / advisor | Review the plan (read-only) |

---

## Enterprise Workflow

This is the **first step in the annual planning cycle**, typically done in fall before the fiscal year starts (Nov 1):

1. Farm owner decides crop rotation, total acres, and yield/price targets based on market outlook, agronomic advice, and rotation history
2. Plan is entered into the system — crops, acres, target yields, expected prices, bins
3. Monthly budget grids are initialized with 12 empty months
4. Over the following weeks, budget cells are filled in across Cost Forecast and Per-Unit
5. When the budget is finalized, the owner **freezes** the budget — creating an immutable snapshot
6. As the year progresses, actuals flow in and are compared against this frozen baseline
7. If the plan changes significantly (e.g., crop failure, re-seeding), admin can **unfreeze**, adjust, and re-freeze

This mirrors the real-world process: plan the year → commit to the plan → measure against the plan.

---

## Interconnections

### Feeds Into
- [[Cost Forecast]] — total acres drives the per-unit ↔ accounting conversion; crops define revenue categories
- [[Per-Unit Analysis]] — $/acre calculations depend on total acres and crop mix
- [[KPI Dashboard]] — yield targets and crop data drive KPI gauges and crop yield cards
- [[Chart of Accounts]] — crop names generate dynamic revenue categories (e.g., "Canola Revenue")
- [[AI Assistant]] — crop plan and targets are part of the farm context sent to the LLM

### Receives From
- [[Agronomy]] — (future) crop rotation recommendations and field-level plans could pre-populate assumptions

### Impacts
- [[Cost Forecast]] — changing acres mid-year recalculates all accounting values
- [[Per-Unit Analysis]] — frozen snapshot is the variance baseline; unfreezing resets comparison

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| Cropwise / agronomy platforms | (Future) Source of crop plans, field data | Inbound |
| None currently | Assumptions are manually entered | — |

---

## Key Business Rules

- Fiscal year runs Nov–Oct (configurable start month per assumption)
- Freezing copies all monthly data to a frozen snapshot table — this is the "budget" baseline for variance
- Only admins can unfreeze; unfreezing keeps the frozen snapshot intact for comparison
- Changing total acres triggers a recalculation of all accounting values (per_unit × new acres)
- Each farm has one assumption record per fiscal year
- Crop revenue categories are dynamically generated from the crops list

---

## Open Questions

- Should we support mid-year crop plan changes (e.g., re-seeding) as a tracked event rather than just editing assumptions?
- Should crop rotation history be tracked year-over-year?

---

## Notes & Sub-Topics

- Budget freeze/unfreeze flow details
- Crop rotation planning considerations

---

## Related Notes

- [[Cost Forecast]]
- [[Per-Unit Analysis]]
- [[KPI Dashboard]]
- [[Chart of Accounts]]
- [[Agronomy]]
