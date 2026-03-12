# LGX Transfer Agreement — User Instructions

This guide walks each role through the LGX transfer agreement workflow. Uses JGL Contract 30040 as the reference example.

## Reference: JGL Contract 30040

| Item | Value |
|------|-------|
| Third-party contract | JGL 30040, 2,500 MT Durum 2CWAD @ $279.25/MT, Nov 20 2025 |
| Truck tickets | 52 loads (Ogema, Lewvan, Balcarres) → LGX, tickets 1134–1222 |
| JGL settlement | #81025, Jan 8 2026, $701,259.09, 2,520.248 MT net |
| Grades in mix | Durum #1 (Balcarres), #3 (Ogema), #4 (Lewvan) |
| Example grade prices | #1 $288/MT, #3 $240/MT, #4 $200/MT (Transfer Agreement) |

---

## 5-Step Overview (All Roles)

1. **Third-party purchase contract** — JGL and LGX agree; contract uploaded to LGX.
2. **Transfer agreement + grade prices** — LGX and C2 Enterprise create the digital twin with grade-level pricing.
3. **Blend requirement** — Cotecna determines blend; LGX enters it; Logistics sees pull list.
4. **Logistics ships; LGX issues transfer settlement** — Grain moves to LGX; LGX issues settlement to C2 Enterprise.
5. **LGX blends and outbound** — LGX loads rail; JGL settles LGX.

---

## LGX Manager

### Step 1 — Third-party purchase contract

- Upload the JGL purchase contract to **LGX Contracts** (Marketing → Terminal Settlements, or LGX Contracts).
- Enter: buyer, commodity, grade (e.g. 2CWAD Durum), tonnage, price per MT, delivery window.
- Example: JGL 30040, 2,500 MT, $279.25/MT.

### Step 2 — Transfer agreement

- Go to **Marketing → Contracts** (ensure Enterprise is selected in the farm dropdown).
- Click **New Contract**. In the dialog, set **Contract Type** to **"Transfer to LGX"** (not "Third Party").
- Fill in counterparty (e.g. LGX or C2), commodity, quantity, and link to the JGL terminal contract if available.
- Enter **grade-level prices** (Add grade price rows): e.g. Durum #1: 288, Durum #3: 240, Durum #4: 200 ($/MT).
  - Durum #1: $288/MT
  - Durum #3: $240/MT
  - Durum #4: $200/MT
- These prices are raw-material valuations. Optionally add a **Blend requirement** (Add blend line: grade, MT).
- Save the contract. It will show an "LGX" badge in the contracts list.

### Step 3 — Blend requirement

- After Cotecna grades inbound inventory, enter the **blend requirement** (grades and quantities).
- Blending details appear in Logistics so the Logistics Manager knows what to pull and from where.
- Pricing from Step 2 is locked in for the transfer settlement.

### Step 4 — Issue transfer settlement

- After tickets arrive at LGX, use **Issue Transfer Settlement** in the LGX module.
- Select inbound tickets, link to the transfer agreement, assign grade and price per line (prices come from Step 2).
- The system calculates value per line and total; issue to C2 Enterprise.

### Step 5 — LGX blend and outbound

- LGX blends per Cotecna spec and loads rail cars.
- JGL settles LGX (e.g. settlement 81025).
- LGX captures value from the spread (sale price vs COGS).

---

## Logistics Manager

### Step 2 — Transfer agreement

- Once LGX enters the blend requirement, you see the transfer agreement and blend details in Logistics.

### Step 4 — Ship grain

- Ship from BUs per the blend requirement and logistics plan (Traction Ag).
- Track origin: farm, bin, grade, crop year.
- LGX tickets are created when grain arrives at LGX.

### Step 5 — Confirm transfer settlement

- View received transfer settlements in **Logistics → Transfer Settlements**.
- Confirm provenance (farm, grade, tonnage) and that values match the agreement.
- This is the memo entry for C2: inventory out, A/R in per BU.

---

## Inventory Manager

### Step 4 — Transfer settlement impact

- The transfer settlement confirms: BU inventory down, LGX raw/WIP up.
- Each line shows source farm, grade, quantity, and value.
- Reconcile bin draws to transfer settlement lines.

### Ongoing

- **Raw goods** = BU bins. **WIP** = LGX bins. **Finished goods** = shipped to buyer.
- Use export reports (CSV/PDF) for inventory audit.

---

## Accountant

### What the transfer settlement does

- **BU**: Sales revenue, A/R increase; inventory decrease at market price.
- **LGX**: Inventory (WIP) increase at market price; A/P to C2 Enterprise (inter-company).
- **At consolidation**: inter-company A/R and A/P eliminate; inventory carried at transfer cost.

### Export

- CSV export provides:
  - Raw → WIP → finished flow
  - Per-line: date, source farm, grade, quantity MT, price/MT, value
  - Suitable for QB import and audit workpapers.

See [LGX_ACCOUNTING](LGX_ACCOUNTING.md) for CSV spec and GAAP notes.
