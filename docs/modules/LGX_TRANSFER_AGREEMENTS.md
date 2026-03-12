# LGX Transfer Agreements and Digital Twin Architecture

> See plan for full design. This doc lives in the repo for reference.

## Executive Vision Summary

- **LGX is a transloader**, not a bonded grain buyer — charges $/MT for blending
- **Enterprise-level transfer agreement**: LGX ↔ C2 Enterprise (one per LGX third-party deal); blend recipe with both bu and MT; logistics sources from any BU
- **Transfer settlement**: LGX issues to C2 Enterprise; lines carry provenance (source_farm_id, grade); each BU gets A/R and inventory entries
- **Both bushels and MT** available everywhere; display default by context

## Implementation Phases

1. **Phase 1**: Transfer agreement model (contract_type, linked_terminal_contract_id, blend recipe), enterprise-level, cross-farm ticket reference
2. **Phase 2**: Transfer settlement model and issuance UI
3. **Phase 3**: Transfer settlement reconciliation and approval
4. **Phase 4**: LGX blend planning linkage
5. **Phase 5**: LGX P&L and QB integration

## Inventory Classification (Accounting Lens)

For QuickBooks export and C2 Farms Enterprise consolidation:

| Stage | Classification | Location | GL Treatment |
|-------|----------------|----------|--------------|
| Farm-level bin inventory | **Raw goods** | BU bins (Ogema, Lewvan, etc.) | Raw materials inventory |
| LGX inbound through blending | **Work in Process (WIP)** | LGX bins | WIP inventory (valuation point) |
| LGX outbound (post-blend) | **Finished goods** | Shipped to buyer | Finished goods; reflects value-add from blending |

**Flow**: Raw goods removed from BU → WIP added to LGX (with valuation) → blending adds value → finished goods shipped. At consolidation (year-end), the wash is: BU raw ↓, LGX WIP ↑, LGX finished ↓ (sale), with clear trail for auditors.

## Audit Output Requirements

- **CSV export**: Clear output tracking the flow (raw → WIP → finished) with valuation points, dates, quantities, and amounts — suitable for import into accounting systems or audit workpapers
- **PDF report**: Auditor-ready report documenting inventory movements, valuation points, and consolidation adjustments — understandable by external auditors

## Related

- [LGX_USER_INSTRUCTIONS](LGX_USER_INSTRUCTIONS.md) — Role-specific workflow (JGL 30040 example)
- [LGX_ACCOUNTING](LGX_ACCOUNTING.md) — GAAP, CSV export spec, audit trail
- [LGX_RECONCILIATION](LGX_RECONCILIATION.md)
- [LGX_TERMINAL_OPERATIONS](LGX_TERMINAL_OPERATIONS.md)
- [LGX_EXECUTIVE_QUESTIONS](LGX_EXECUTIVE_QUESTIONS.md)
