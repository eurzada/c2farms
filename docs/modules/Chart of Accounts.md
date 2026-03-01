# Chart of Accounts

> **Status**: `Complete`
> **Priority**: `High`
> **Owner**:
> **Last Updated**: 2026-02-28

---

## Problem Statement

Farm financial data comes from QuickBooks (or similar accounting software) at the GL account level — dozens of individual accounts like "Seed Treatment", "Herbicides", "Fuel", "Machinery Lease Payments". But farm managers think in broader categories: Inputs, LPM, Insurance. There needs to be a mapping layer that translates the bookkeeper's chart of accounts into the farmer's reporting categories. Without this, every data import requires manual re-categorization.

---

## Core Function

Manages the two-level structure that bridges accounting and farm reporting: (1) the farm's reporting category hierarchy (Revenue, Inputs, LPM, LBF, Insurance and their children), and (2) the GL account master list with each account mapped to a reporting category. When actuals are imported, GL accounts roll up to their assigned categories automatically.

---

## Who Uses This

| Role | Goal |
|------|------|
| Farm owner / admin | Set up category structure, map GL accounts to categories, manage chart of accounts |
| Farm manager | Assign new GL accounts to categories when they appear in QB exports |
| Viewer / advisor | Understand how the books map to the reporting categories (read-only) |

---

## Enterprise Workflow

This module is the **configuration backbone** — set up once, adjusted as needed:

1. When a farm is created, admin initializes categories from the default template (Revenue, Inputs, LPM, LBF, Insurance with standard children)
2. Crop-specific revenue categories are auto-generated from the assumptions crop list
3. As the first GL data import happens (CSV from QBO), new GL accounts are created and mapped to leaf categories
4. If a GL account doesn't have a mapping, the manager assigns it via the Chart of Accounts page
5. Bulk assignment allows remapping multiple accounts at once with automatic re-rollup
6. The YTD view shows how much has flowed through each GL account and category

This is the bridge between the **bookkeeper's world** (QuickBooks GL accounts) and the **farmer's world** (operational expense categories).

---

## Interconnections

### Feeds Into
- [[Cost Forecast]] — category hierarchy defines the rows in the accounting grid
- [[Per-Unit Analysis]] — same category hierarchy defines per-unit rows
- [[KPI Dashboard]] — category groupings drive the budget vs forecast chart

### Receives From
- [[Yield & Assumptions]] — crop names drive dynamic revenue category generation
- [[QuickBooks Integration]] — (future) GL accounts synced from QB would register here

### Impacts
- [[Cost Forecast]] — remapping a GL account to a different category shifts actuals between rows
- [[Per-Unit Analysis]] — same downstream effect via the accounting ↔ per-unit sync

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| QuickBooks Online | Source of GL account names and numbers | Inbound (CSV now, API future) |

---

## Key Business Rules

- Categories are per-farm — each farm has its own hierarchy
- Only leaf categories (no children) can have GL accounts mapped to them
- Default template: Revenue → Inputs → LPM → LBF → Insurance with standard subcategories
- Crop revenue categories are generated dynamically from assumption crops
- Category cache refreshes every 5 minutes
- GL accounts are soft-deleted (deactivated), not hard-deleted, to preserve historical data
- Re-assigning a GL account triggers a rollup recalculation for affected months

---

## Open Questions

- Should we support custom category types beyond the five standard ones?
- How should we handle GL accounts that span multiple categories (split allocations)?
- Should there be a "suggested mapping" feature based on account name patterns?

---

## Notes & Sub-Topics

- Default category template structure
- GL rollup logic
- Category code conventions

---

## Related Notes

- [[Yield & Assumptions]]
- [[Cost Forecast]]
- [[Per-Unit Analysis]]
- [[QuickBooks Integration]]
