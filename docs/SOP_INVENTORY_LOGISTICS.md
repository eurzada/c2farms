# C2 Farms — Inventory & Logistics Standard Operating Procedures

## Overview

This document defines the month-end close process for grain inventory and logistics at C2 Farms. The close cycle runs from the 1st to the 10th of each month, covering bin counts, ticket imports, settlement reconciliation, and marketing position verification across all seven business unit locations.

The goal is to produce an accurate ending inventory position and ensure all hauled grain is reconciled against buyer settlements before the books close.

---

## Team Roles & Responsibilities

### Location Managers (7 Locations)

Each location manager is responsible for physically counting bins at their site and entering results into the system.

- **Locations**: Balcarres, Hyas, Lewvan, Stockholm, Ridgedale, Ogema, Provost
- **Deadline**: 5th of each month
- **System view**: Inventory > FM Count
- **Note**: Provost has no bin infrastructure — agronomy and forecast only, no inventory counts required
- **Note**: Waldron bins fall under Stockholm — Stockholm manager counts both

### Jessica (Admin / Operations)

Jessica handles all data ingestion from external systems and first-pass reconciliation.

- Import Traction Ag delivery CSVs (Logistics > Tickets > Import CSV)
- Upload buyer settlement PDFs (Logistics > Settlements > Upload)
- Run auto-reconciliation to match tickets against settlements
- Flag unmatched or problematic tickets for Collin
- **Deadline**: 5th of each month

### Collin (Inventory & Logistics Manager)

Collin owns the month-end close and is accountable for the accuracy of the final inventory position.

- Review and approve bin count submissions from all locations
- Run month-end reconciliation across all commodities
- Investigate and document variances exceeding 2%
- Verify marketing position accuracy (available-to-sell vs actual inventory)
- Review contract fulfillment progress and coordinate deliveries
- **Deadline**: 10th of each month

### Marketing Team

The marketing team operates on a separate cadence but feeds into the logistics workflow.

- Negotiate and create contracts in Marketing > Contracts
- Upload signed contract PDFs for reference
- Hand off delivery coordination to Collin once a contract is executed
- Review commitment matrix and available-to-sell weekly

---

## Monthly Close Process

### Step 1: Bin Counts (Days 1-5)

**Owner**: Location Managers | **Reviewer**: Collin

1. Open **Inventory > FM Count**
2. Select the current count period (e.g., "March 2026"). If no period exists, contact admin to create one.
3. For each bin at the location:
   - Enter the current bushel reading
   - Confirm the commodity assignment is correct (system will compute kg from lbs_per_bu)
   - Confirm the crop year is correct
   - Add notes for any special situations (treated seed, reserved grain, damaged product)
4. Save the count submission (status: **draft**)
5. When all bins are entered, submit for review (status: **submitted**)
6. Collin reviews and either approves or rejects with comments
7. If rejected, correct the flagged bins and resubmit

**Tips**:
- Count bins in a consistent order to avoid double-counting
- If a bin has mixed commodity (rare), record under the primary commodity and note the mix
- Notes carry forward between count periods — update rather than duplicate

### Step 2: Ticket Import & Settlement (Days 1-5)

**Owner**: Jessica

#### 2a. Import Delivery Tickets

1. Download the latest CSV export from Traction Ag
2. Navigate to **Logistics > Tickets > Import CSV**
3. Upload the CSV file
4. Review the import preview:
   - Check total record count against Traction Ag
   - Resolve any flagged duplicates (tickets already in system)
   - Verify commodity and buyer mappings look correct
5. Commit the import
6. Spot-check a few tickets against the CSV to confirm data integrity

#### 2b. Upload Settlement PDFs

1. Collect settlement PDFs from buyers (email, portal downloads)
2. Navigate to **Logistics > Settlements > Upload**
3. Upload each PDF — the system uses AI (Claude Vision) to extract settlement data:
   - Buyer name, settlement date
   - Commodity, grade, quantity (MT)
   - Price, deductions, net payment
4. Review extracted data for accuracy
5. Correct any extraction errors before saving

#### 2c. Run Auto-Reconciliation

1. Navigate to **Logistics > Settlements > Reconcile**
2. Run the auto-reconciliation — the system matches delivery tickets to settlement lines by:
   - Ticket number
   - Commodity and buyer
   - Quantity (within tolerance)
3. Review the results:
   - **Matched**: Ticket and settlement line paired — no action needed
   - **Unmatched tickets**: Hauled but no settlement yet — may be pending from buyer
   - **Unmatched settlements**: Settlement received but no corresponding ticket — check for missing imports
4. For unmatched items, either:
   - Manually match if the system missed an obvious pair
   - Flag for Collin with notes on what is missing

### Step 3: Month-End Reconciliation (Days 5-10)

**Owner**: Collin

1. Open **Inventory > Dashboard** (ensure Enterprise view is selected)
2. Open the **Monthly Reconciliation** summary
3. For each commodity, verify the following equation:

   ```
   Expected Closing = Beginning Inventory - Shipped - Withdrawals
   Variance = Actual Closing (bin count) - Expected Closing
   ```

   | Field | Source |
   |-------|--------|
   | Beginning inventory | Previous month's approved ending balance |
   | Shipped MT | Sum of hauled tickets + elevator settlement quantities |
   | Withdrawals | Seed, feed, losses, consumption recorded in FM Count |
   | Actual closing | Current month's approved bin counts |

4. Acceptable variance: **< 2%** of beginning inventory
5. For any variance exceeding 2%, investigate:
   - **Check for missed ticket imports**: Cross-reference Traction Ag export against system ticket count
   - **Verify bin count accuracy**: Request a recount of suspect bins
   - **Check for unrecorded withdrawals**: Confirm with location managers if grain was used for seed, feed, or other purposes
   - **Check LGX transfers**: LGX inventory is tracked separately — verify the wash section (grain in transit to/from LGX) is correct
   - **Check crop year assignments**: Ensure bins are not tagged with the wrong crop year, which would shift quantities between reporting buckets
6. Document the explanation for each variance in the reconciliation notes
7. Once satisfied, approve the month-end position

### Step 4: Marketing Position Review (Day 10)

**Owner**: Collin | **Stakeholders**: Marketing Team

1. Open **Marketing > Dashboard**
2. Verify **Contract Fulfillment** — hauled MT vs contracted MT for each active contract
3. Review the **Commitment Matrix** by buyer:
   - Total contracted vs total delivered
   - Remaining to deliver per contract
4. Confirm **Available-to-Sell** matches actual inventory:
   - Available-to-sell = Total inventory - Contracted (undelivered) - Non-market bins
   - Cross-reference against the reconciliation closing balance
5. Flag any contracts at risk of under-delivery or over-commitment

---

## Contract Lifecycle

| Stage | Action | Owner |
|-------|--------|-------|
| **Negotiated** | Marketing team agrees terms with buyer | Marketing |
| **Executed** | Contract created in Marketing > Contracts, PDF uploaded | Marketing |
| **In Delivery** | Collin coordinates trucking schedule, loads begin hauling | Collin |
| **Delivered** | All contracted tonnage has been hauled (per tickets) | Collin |
| **Settled** | Buyer issues settlement, Jessica uploads and reconciles | Jessica |

Detailed steps:

1. Marketing team negotiates contract terms with buyer
2. Contract created in **Marketing > Contracts** with pricing type (flat, basis, HTA, min price, or deferred)
3. Signed contract PDF uploaded for reference
4. Collin receives notification and coordinates delivery schedule with truckers
5. Truckers haul grain — each load tracked via delivery tickets (Traction Ag or mobile app)
6. Once buyer receives and processes grain, they issue a settlement
7. Jessica uploads the settlement PDF and runs reconciliation
8. Upon full reconciliation, contract status moves to **settled**

---

## Key Reports

| Report | Location | Frequency | Owner |
|--------|----------|-----------|-------|
| Bin Count Export | FM Count > Export CSV | Monthly | Location Managers |
| Ticket Register | Tickets > Export (Excel/PDF/CSV) | As needed | Jessica |
| Settlement Summary | Settlements > Export | As needed | Jessica |
| Grading Report | Grading > Export | As needed | Collin |
| Monthly Reconciliation | Dashboard > Recon Summary | Monthly | Collin |
| Contract Fulfillment | Marketing Dashboard | Weekly | Collin |
| Marketing Position | Marketing Dashboard | Weekly | Marketing |

---

## Troubleshooting

### Common Variance Causes

| Cause | How to Check | Resolution |
|-------|-------------|------------|
| Missed ticket import | Compare Traction Ag export count against system ticket count | Re-import missing CSV range |
| Bin count error | Request recount of suspect bins from location manager | Correct count, resubmit |
| Unrecorded withdrawal | Confirm with location manager (seed, feed, losses) | Add withdrawal record in FM Count |
| LGX transfers | Verify LGX wash section — grain in transit should net to zero | Correct LGX incoming/outgoing records |
| Crop year mismatch | Check bin commodity and crop year assignments | Update bin tags, recount if needed |
| Duplicate tickets | Check for tickets imported more than once | Remove duplicates via Tickets page |
| Settlement extraction error | Compare extracted data against PDF visually | Edit settlement line manually |

### Non-Market Bins

Certain bins are excluded from the marketing position and available-to-sell calculations:

- **Seed**: Treated or reserved seed stock (e.g., Bin 114 Lewvan — treated seed durum)
- **Feed**: Grain allocated for livestock feed
- **Reserved**: Grain held back for any operational reason
- **Consumption**: On-farm use

To flag a bin as non-market:
1. Open **Inventory > Bins**
2. Set the **Purpose** column to the appropriate category
3. Add a note explaining the reservation
4. Non-market bins still appear in inventory counts but are excluded from marketing position

### LGX-Specific Considerations

LGX (transit terminal) operates differently from farm locations:

- LGX inventory is tracked at the enterprise level, not per-BU
- Grain routed through LGX is blended and loaded into rail cars — ticket-to-settlement matching uses **tonnage reconciliation** (aggregate MT), not individual ticket matching
- The LGX wash section in reconciliation should net to zero (grain in = grain out)
- LGX is excluded from standard farm bin counts

---

## Monthly Close Calendar

| Day | Activity | Owner |
|-----|----------|-------|
| 1 | Count period opens — location managers begin bin counts | Location Managers |
| 1-3 | Jessica begins importing Traction Ag CSVs and settlement PDFs | Jessica |
| 5 | **Deadline**: All bin counts submitted, all tickets/settlements imported | Location Managers, Jessica |
| 5-7 | Collin reviews bin counts, approves or rejects submissions | Collin |
| 5-7 | Jessica completes auto-reconciliation, flags unmatched items | Jessica |
| 7-10 | Collin runs month-end reconciliation, investigates variances | Collin |
| 10 | **Deadline**: Month-end position finalized and approved | Collin |
| 10 | Marketing position review complete | Collin, Marketing |

---

## System Access

- **URL**: Configured per deployment environment
- **Accounts**: Contact admin (Jessica) for new user setup or role changes
- **Roles**:
  - **Admin**: Full access — user management, data import, approvals
  - **Manager**: Edit access — bin counts, contract management, reconciliation
  - **Viewer**: Read-only — reports and dashboards only
- **Enterprise View**: Default view shows all locations. Switch to a specific BU using the farm selector in the header.
- **Support**: For system issues, contact the development team. For process questions, contact Collin.
