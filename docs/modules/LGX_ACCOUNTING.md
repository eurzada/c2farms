# LGX Transfer Settlement — Accounting and Export

Covers inter-company accounting (GAAP), CSV export spec, and audit trail for raw → WIP → finished inventory flow.

## Inter-Company Accounting (GAAP)

### Transfer price

- Transfer at **market price** (arm’s length) is preferred.
- Avoids transfer-pricing distortion and supports clean consolidation.

### Separate legal entities (LGX and C2)

- **BU**: Books sale, revenue, A/R increase; inventory decrease at market price.
- **LGX**: Books inventory (WIP) increase at market price; A/P to C2 Enterprise.
- **At consolidation**: Inter-company A/R and A/P eliminate; inventory stays at cost to the group.
- Intercompany profit above the selling company’s cost is eliminated in consolidated financials.

### Single entity

- Treat as internal transfer: BU inventory out, LGX WIP in at market.
- No inter-company profit to eliminate.

### Tax

- If LGX and C2 are separate entities, tax on the seller’s intercompany profit is deferred until the asset is sold to a third party.

---

## Inventory Classification

| Stage | Classification | Location | GL Treatment |
|-------|----------------|----------|--------------|
| Farm-level bin inventory | Raw goods | BU bins | Raw materials inventory |
| LGX inbound through blending | WIP | LGX bins | WIP inventory (valuation point) |
| LGX outbound (post-blend) | Finished goods | Shipped to buyer | Finished goods; reflects value-add |

**Flow**: Raw goods removed from BU → WIP added to LGX (at valuation) → blending adds value → finished goods shipped.

---

## CSV Export Specification

### Endpoint

`GET /api/farms/:farmId/transfer-settlements/:id/export?format=csv`

### Columns

| Column | Description | Example |
|--------|-------------|---------|
| settlement_id | UUID | abc-123 |
| settlement_number | Human-readable | TRF-001 |
| settlement_date | Date | 2026-01-08 |
| transfer_agreement_id | Marketing contract ID | xyz-456 |
| linked_terminal_contract | Third-party sale reference | JGL 30040 |
| line_number | Line sequence | 1 |
| source_farm_id | BU farm UUID | farm-ogema |
| source_farm_name | BU name | Ogema |
| grade | Grain grade | Durum #1 |
| commodity | Commodity name | Durum |
| net_weight_mt | Net tonnes | 42.5 |
| price_per_mt | Transfer price | 288.00 |
| line_net | Line value (CAD) | 12240.00 |
| delivery_date | Line delivery date | 2025-11-24 |
| ticket_number | LGX ticket # | 1149 |

### Use cases

- QB/GL import
- Raw → WIP → finished audit trail
- Consolidation adjustments
- Auditor workpapers

---

## Related

- [LGX_TRANSFER_AGREEMENTS](LGX_TRANSFER_AGREEMENTS.md) — Architecture and phases
- [LGX_USER_INSTRUCTIONS](LGX_USER_INSTRUCTIONS.md) — Role-specific workflow
- [LGX_RECONCILIATION](LGX_RECONCILIATION.md) — Tonnage reconciliation
