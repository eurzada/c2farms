# Operational Data

> **Status**: `Complete`
> **Priority**: `Medium`
> **Owner**:
> **Last Updated**: 2026-02-28

---

## Problem Statement

Financial numbers tell you what you spent, but not how efficiently you operated. A farmer needs to track the physical inputs that drive costs — how many labour hours, equipment hours, and litres of fuel were consumed each month. Without this, they can't connect financial overruns to operational causes. "Fuel is 20% over budget" only becomes actionable when you know whether that's because of more hours in the field or higher fuel prices.

---

## Core Function

Tracks non-financial operational metrics by month: labour hours, equipment hours, and fuel litres. Each metric has a budget and actual value per month, allowing the farmer to compare planned vs actual operational intensity alongside the financial data.

---

## Who Uses This

| Role | Goal |
|------|------|
| Farm manager | Track crew hours, equipment usage, fuel consumption against plan |
| Farm owner / admin | Understand operational efficiency, justify equipment or staffing decisions |
| Viewer / advisor | Assess operational intensity for benchmarking |

---

## Enterprise Workflow

This module tracks the **physical side of farming operations**:

1. During budgeting, the manager estimates monthly labour hours (seeding crew in May, harvest crew in Sep-Oct), equipment hours, and fuel consumption
2. Throughout the year, actuals are entered — either from timesheets, fuel receipts, or equipment hour meters
3. The comparison reveals operational efficiency: if fuel actuals are over but equipment hours are on target, the issue is fuel price not usage
4. This data contextualizes the financial numbers — the "why" behind the dollars

The metrics align with the farming calendar: minimal in winter, ramping up in spring (seeding), moderate in summer (spraying), peaking in fall (harvest).

---

## Interconnections

### Feeds Into
- [[KPI Dashboard]] — labour cost/acre KPI combines operational hours with financial data
- [[AI Assistant]] — operational metrics provide context for financial analysis

### Receives From
- [[Yield & Assumptions]] — fiscal year and farm definition

### Impacts
- [[Cost Forecast]] — operational data explains variances in LPM categories (personnel, fuel, repairs)

---

## External Systems

| System | Role | Data Flow |
|--------|------|-----------|
| Timesheets / payroll | Source of labour hours | Manual entry (future: integration) |
| Equipment telematics | Source of equipment hours | Manual entry (future: integration) |
| Fuel cards / receipts | Source of fuel litres | Manual entry (future: integration) |

---

## Key Business Rules

- Three metrics tracked: `labour_hours`, `equipment_hours`, `fuel_litres`
- Each has a budget value and actual value per month
- Data is per-farm, per-fiscal-year, per-month
- No direct calculation link to financial data — the correlation is analytical, not automatic

---

## Open Questions

- Should we add more metrics (e.g., chemical application hours, trucking hours)?
- Should operational data feed into per-unit cost calculations (e.g., fuel cost per hour)?
- Is there value in integrating with telematics platforms (John Deere Operations Center, CNH)?

---

## Notes & Sub-Topics

- Potential telematics integrations
- Metric expansion roadmap

---

## Related Notes

- [[KPI Dashboard]]
- [[Cost Forecast]]
- [[Yield & Assumptions]]
