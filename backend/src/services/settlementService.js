import prisma from '../config/database.js';
import { MODELS, PRICING, computeUsage, classifyApiError, getAnthropicClient, parseJsonResponse } from './aiClient.js';

/**
 * The extraction prompt template for each buyer format.
 */
const EXTRACTION_PROMPTS = {
  cargill: `You are extracting data from a Cargill grain settlement PDF. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string",
  "settlement_date": "YYYY-MM-DD",
  "buyer": "Cargill",
  "contract_number": "string (the Contract # from the contract breakdown or per-ticket detail rows — look for a numeric contract number like '2100459885')",
  "commodity": "string (look for the grain/commodity name — e.g. 'Canola', 'CWRS', 'Durum Wheat', 'Barley'. Check the first page summary, contract breakdown section, or product/grain column)",
  "total_gross_amount": number,
  "total_net_amount": number,
  "settlement_gross": number or null (same as total_gross_amount — the total gross payable BEFORE all deductions),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string (the weigh scale ticket number — this is the number that matches the trucker's scale ticket, NOT Cargill's internal receipt/unit number)",
      "delivery_date": "YYYY-MM-DD",
      "contract_number": "string or null (per-ticket Contract #)",
      "gross_weight_mt": number,
      "net_weight_mt": number,
      "grade": "string or null",
      "moisture_pct": number or null,
      "dockage_pct": number or null,
      "price_per_mt": number or null,
      "price_per_bu": number or null,
      "line_gross": number or null,
      "line_net": number or null,
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

IMPORTANT: Look carefully for the contract number and commodity:
- Contract # appears in the "Contract Summary" section, per-ticket detail rows (Contract# column), or the settlement header. It is usually a long numeric string (e.g. "2100459885" or "2100333513").
- Commodity/grain type appears in the settlement summary or header (e.g. "Canola", "1 CWRS", "Durum", "Barley"). Also check the "Product" or "Grain" fields.
- If there are multiple contracts in one settlement, use the primary/most common contract number for the top-level field and include per-line contract_number.

Look for Settlement Details tables with per-ticket rows. IMPORTANT: Cargill settlements may show multiple numbers per ticket line — a Unit# (Cargill's internal receipt number) and potentially a weigh scale number. The ticket_number should be the WEIGH SCALE number (the smaller number that the trucker receives at the scale), NOT Cargill's large internal Unit#. If only one number is available per line, use that. Extract ALL ticket rows even across multiple pages.

DEDUCTIONS: On page 1, look for the Settlement Summary section which shows Gross Payable, then line items like "Drying discount", "Saskatchewan Wheat Development Commission", "Drying Adjustment", and "Net Payable". Extract these into deductions_summary with appropriate categories (drying, checkoff/levy, quality, etc.). settlement_gross = Gross Payable. Return ONLY valid JSON, no extra text.`,

  bunge: `You are extracting data from a Bunge grain settlement PDF ("Settlement Advice"). Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (the Settlement # from the header, e.g. '4498650')",
  "settlement_date": "YYYY-MM-DD (the Issue Date or Payment Date)",
  "buyer": "Bunge",
  "contract_number": "string (the primary Contract # — if multiple contracts, use the most common one)",
  "commodity": "string (e.g. 'Yellow Peas', 'Canola', from the Primary Elevator Receipt Summary)",
  "total_gross_amount": number,
  "total_net_amount": number (the Net Payable amount),
  "settlement_gross": number or null (the Gross Payable amount BEFORE adjustments),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string — MUST be the BOL or Car # (the trucker's weigh scale ticket number, e.g. '91131'). See column mapping below.",
      "delivery_number": "string or null — the Delivery # (Bunge's internal number, e.g. '469692')",
      "receipt_number": "string or null — the Receipt # (Bunge's internal receipt number, e.g. '307860')",
      "delivery_date": "YYYY-MM-DD",
      "contract_number": "string or null (per-line Contract #)",
      "gross_weight_mt": number or null (Unload Weight),
      "net_weight_mt": number or null (Net Weight),
      "grade": "string or null",
      "moisture_pct": number or null,
      "dockage_pct": number or null,
      "price_per_mt": number or null (Net Price),
      "line_gross": number or null (Gross Amount),
      "line_net": number or null,
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

CRITICAL — Bunge "Primary Elevator Receipt Details" column mapping:
The detail pages have TWO rows per ticket and these columns:
  Row 1: Delivery # | Receipt # | Contract # | Dry/Loss Pts | Dry/Loss % | Dockage % | Storage Days
  Row 2: Delivered On | BOL or Car # | Shipment # | Unload Weight | Dry/Loss | Dockage | Net Weight | Net Price | Gross Amount

- **Delivery #** (first column, row 1): Bunge's INTERNAL delivery number (e.g. 469546, 303649). Do NOT use this as ticket_number.
- **Receipt #** (second column, row 1): Bunge's INTERNAL receipt number (e.g. 307860, 695706). Do NOT use this as ticket_number. Put this in "receipt_number".
- **BOL or Car #** (second column, row 2): The trucker's WEIGH SCALE ticket number (e.g. 91131). USE THIS as the ticket_number field.
- The BOL or Car # matches the "From Ticket #" / "To Ticket #" in the trucker's Traction Ag CSV export.

DEDUCTIONS: Look for "Property Pricing Details" and "Adjustment Details" sections. These show deductions like PROPERTY PRICING (category: quality), SASK. PULSE LEVY or other crop levies (category: levy), with Tax column for GST. Extract into deductions_summary. settlement_gross = Gross Payable.

Extract ALL ticket rows across ALL pages. Return ONLY valid JSON, no extra text.`,

  jgl: `You are extracting data from a JGL Commodities grain settlement document. This may be a photographed/scanned document that could be rotated. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string",
  "settlement_date": "YYYY-MM-DD",
  "buyer": "JGL Commodities",
  "contract_number": "string",
  "commodity": "string",
  "total_gross_amount": number,
  "total_net_amount": number,
  "settlement_gross": number or null (Total Gross from the Deduction Summary — BEFORE charges/levies),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string (the weigh scale ticket number — the number matching the trucker's scale ticket from Traction Ag, NOT the buyer's internal receipt number)",
      "delivery_date": "YYYY-MM-DD",
      "vehicle_id": "string or null",
      "origin": "string or null",
      "gross_weight_mt": number,
      "net_weight_mt": number,
      "grade": "string or null",
      "dockage_pct": number or null,
      "price_per_mt": number or null,
      "line_gross": number or null,
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

JGL documents show: ID, Contract#, Commodity, Settlement No, per-ticket rows with Ticket No, Vehicle Id, Date, Origin/CGC, MT Applied, Grade, DO. Also look for deduction summaries (Checkoff Levy, Drying, Quality discounts, Freight). IMPORTANT: If the document shows multiple ticket/reference numbers per line, use the weigh scale number (the one matching the trucker's scale ticket) as the ticket_number.

DEDUCTIONS: Look for "Deduction Summary" section (usually last page). It shows: Total Gross, Total Discounts (Quality, Drying, Stor./DP), Total Charges (SWDC7 = checkoff levy), Freight, Other, GST. Extract into deductions_summary. settlement_gross = Total Gross. Category mapping: SWDC7/Checkoff=checkoff, Drying=drying, Quality=quality, Freight=freight, Stor./DP=storage. Return ONLY valid JSON, no extra text.`,

  gsl: `You are extracting data from a GSL (Grain St-Laurent Inc.) grain settlement PDF. This is a bilingual English/French document. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (the 'Outgoing Payment # / # de paiement' from the summary page header)",
  "settlement_date": "YYYY-MM-DD (the 'Payment Date / Date de paiement' in m/d/y format — convert to YYYY-MM-DD)",
  "buyer": "GSL (Grain St-Laurent Inc.)",
  "contract_number": null,
  "commodity": "string (from individual ticket 'Product / Produit' field, e.g. 'Wheat (Milling)' or 'Spring Wheat')",
  "total_gross_amount": number or null,
  "total_net_amount": number (the 'Total Amount Due / Montant total dû'),
  "settlement_gross": number or null (total gross before deductions/levies),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string — MUST be the 'GSL Reference Number / Numéro de référence GSL' (e.g. '391242'). This is the delivery ticket number that matches the trucker's weigh scale ticket.",
      "supplier_reference": "string or null — the 'Supplier Reference Number / Numéro de référence fournisseur'",
      "ap_invoice_number": "string or null — the 'A/P Invoice #' (GSL's internal doc number, e.g. '580022')",
      "delivery_date": "YYYY-MM-DD (from 'Product Pickup Date / Date de ramassage du produit' — CAREFUL: format is m/d/y, convert to YYYY-MM-DD)",
      "commodity": "string or null (from 'Product / Produit' on each ticket page)",
      "gross_weight_mt": number (from Scale Record 'Gross Weight / Poids brut')",
      "net_weight_mt": number (from Scale Record 'Net Weight / Poids net' — this is AFTER dockage/shrink deductions)",
      "unloaded_weight_mt": number or null (from 'Weight of unloaded grain / Poids du grain déchargé')",
      "grade": "string or null",
      "moisture_pct": number or null (from 'Moisture / Humidité')",
      "dockage_pct": number or null (from 'Dockage / Déchets')",
      "shrink_pct": number or null (from 'Shrink / Freinte')",
      "price_per_mt": number or null (from 'Contracted Price per Unit / Prix contracté par unité' — this is $/MT)",
      "line_gross": number or null (from 'Gross Amount Payable / Montant brut payable')",
      "line_net": number or null (from 'Net Amount Payable / Montant net payable')",
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

GSL SETTLEMENT LAYOUT — READ CAREFULLY:
- Page 1 is a "Settlement Summary / Sommaire du règlement" with an Items table listing ALL tickets. The table columns are:
  Document | Doc. No. | Date | GSL Reference Number / Numéro de référence GSL | Currency | Discount | Net Amount Due
- Subsequent pages are individual ticket detail pages (one per ticket).

CRITICAL FIELD MAPPING:
- **GSL Reference Number** = the delivery ticket number (e.g. 391242). This is what goes in ticket_number. It matches the trucker's weigh scale ticket.
- **Doc. No.** = GSL's internal A/P Invoice number (e.g. 580022). This is NOT the ticket number.
- **Supplier Reference Number** = usually same as GSL Reference Number. Store separately.
- **Product Pickup Date** format is m/d/y (e.g. 01/23/2026 = January 23, 2026). Convert carefully to YYYY-MM-DD.
- Weights are in MT (metric tonnes) — look for "mt" suffix on the scale record values.
- Deductions include: Provincial/State Grain Levy/Checkoff, Discount/Escompte. Extract these from each ticket page.

You can extract line data from EITHER the summary table (quick but less detail) or the individual ticket pages (full detail). Prefer the individual ticket pages for complete data. Extract ALL tickets across ALL pages. Return ONLY valid JSON, no extra text.`,

  richardson: `You are extracting data from a Richardson Pioneer grain settlement PDF (titled "Cash Purchase Ticket" or "Settlement Details"). Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (the Settlement No.)",
  "settlement_date": "YYYY-MM-DD (the Settlement Date)",
  "buyer": "Richardson Pioneer",
  "contract_number": "string (the Contract # — if multiple contracts appear, use the most common one)",
  "commodity": "string (the Grain field, e.g. 'WHEAT CWRS')",
  "crop_year": "string or null",
  "station": "string or null (delivery station name, e.g. 'CROOKED RIVER HT')",
  "total_gross_amount": number (the TOTALS row Gross Amount, or sum of all line Gross Amounts),
  "total_net_amount": number (the NET SETTLEMENT AMT),
  "settlement_gross": number or null (the TOTALS row Gross Amount — gross before Adjustment deductions),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string — MUST be the Weigh # (see instructions below)",
      "weigh_number": "string (the Weigh # — ALWAYS extract this separately even if you also put it in ticket_number)",
      "station_receipt_number": "string or null (the Station/Receipt # — Richardson's internal receipt number, 9+ digits)",
      "load_number": "string or null (the Load # — Richardson's internal load number, 9+ digits)",
      "delivery_date": "YYYY-MM-DD (the Dlvy Date)",
      "contract_number": "string or null (per-line Contract #)",
      "grade": "string or null (e.g. '1 CW RS 135')",
      "moisture_pct": number or null (Moist %),
      "dockage_pct": number or null (Dock %),
      "protein_pct": number or null (Prot %),
      "gross_weight_mt": number or null (Unload Weight in MT),
      "net_weight_mt": number or null (Net Weight in MT — after dockage and cleaning),
      "price_per_mt": number or null (Base Price),
      "line_gross": number or null (Gross Amount),
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

RICHARDSON PIONEER LAYOUT — READ CAREFULLY:
The settlement has columns in this order:
  Station | Load # | Receipt # | Weigh # | Dlvy Date | Ref 2 % | Contract # | Order # | Moist | Dock | Prot | Unload Weight | Clean Weight | Net Weight | Base Price | Gross Amt | Rate | Net Amt

There are THREE different ID numbers per ticket line — you MUST distinguish them:
1. **Station/Receipt #** = a 9-digit number (e.g. 169305054) — this is Richardson's INTERNAL receipt. Put in "station_receipt_number".
2. **Load #** = a 9-digit number (e.g. 169175034) — this is Richardson's INTERNAL load tracking number. Put in "load_number".
3. **Weigh #** = a SHORT number, typically 5-6 digits (e.g. 245389, 245328, 121907) — this is the TRUCKER'S weigh scale ticket number. Put in BOTH "ticket_number" AND "weigh_number".

CRITICAL RULE: The ticket_number MUST be the Weigh # — the SHORT number (5-6 digits). It is NEVER a 9-digit number.
- If you see a 9-digit number, it is either Station/Receipt # or Load # — NOT the Weigh #.
- The Weigh # is always the shortest numeric identifier in each ticket block.
- Examples of CORRECT ticket_number values: "245389", "245328", "121907", "121926"
- Examples of WRONG ticket_number values: "169175034" (Load #), "169305054" (Station/Receipt #)

Also extract: Grade, Moist/Dock/Prot %, Unload/Clean/Net Weight (all in MT), Base Price, Gross Amount. Below each ticket row are per-ticket Adjustments (DRYING, QUALITY SPREAD ADJ, SK WHT CHK OFF, SASK CANOLA DEV COMM, etc.) — extract these as deductions with their dollar amounts.

DEDUCTIONS: The last page has a TOTALS row and an Adjustment/Remarks summary table showing deduction names (e.g. "SASK CANOLA DEV COMM", "SK WHT CHK OFF", "DRYING"), PST, GST flags (Y/N), and total Amount. Extract these into deductions_summary. Category mapping: CANOLA DEV COMM/SK WHT CHK OFF=checkoff, DRYING=drying, QUALITY SPREAD=quality. settlement_gross = TOTALS Gross Amount. Extract ALL ticket rows across ALL pages. Return ONLY valid JSON, no extra text.`,

  ldc: `You are extracting data from a Louis Dreyfus Company (LDC) grain settlement PDF titled "Cash Ticket Detail". Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (the large highlighted number at the very top next to 'Cash Ticket Detail' — e.g. '571040066092'. This is NOT the contract number.)",
  "settlement_date": "YYYY-MM-DD (the date printed below the Cash Ticket Detail header)",
  "buyer": "Louis Dreyfus Company Canada ULC",
  "contract_number": "string (the 'Contract' number from the Assembly section — e.g. '8008913'. This is the line labeled 'Contract' under 'Assembly #'. Do NOT confuse it with the settlement number or the Assembly # itself.)",
  "assembly_number": "string or null (the Assembly # — e.g. '571020120184')",
  "commodity": "string (from the commodity code in the Assembly section — e.g. 'NEX' = Canola. Map common LDC codes: NEX=Canola, DUR=Durum, CWRS=Spring Wheat, CPS=CPS Wheat, YP=Yellow Peas, LP=Lentils, BLY=Barley, FLX=Flax, CHKP=Chickpeas)",
  "total_gross_amount": number (the Gross Amt column value in the Assembly row, e.g. 644786.28),
  "total_net_amount": number (the Net Amount column value in the Assembly row, e.g. 657711.03),
  "settlement_gross": number or null (same as total_gross_amount — the gross BEFORE program charges),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions/charges), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string (the Ticket Number from per-ticket rows — e.g. '5717345236'. These are 10-digit weigh scale numbers in the detail section BELOW the Assembly summary. Do NOT use the Assembly # or Contract # as a ticket number.)",
      "contract_number": "string or null (the Contract number for the Assembly this ticket belongs to — e.g. '8008913'. CRITICAL for multi-contract settlements.)",
      "delivery_date": "YYYY-MM-DD",
      "split_pct": number or null (the Split % column),
      "gross_weight_mt": number or null (the Gross column — in MT),
      "dockage_mt": number or null (the Dockage column — in MT, often shown as negative in parentheses)",
      "net_weight_mt": number or null (the Net column — in MT),
      "grade": "string or null (extract TDK/DGR/DMG/MOIST/HTD/LIN/OLE/OL grading values if present)",
      "moisture_pct": number or null (from MOIST value in the grading row)",
      "dockage_pct": number or null (from TDK value in the grading row)",
      "price_per_mt": number or null (the Price column, e.g. 710.90)",
      "line_gross": number or null,
      "line_net": number or null (PriceQty × Price)",
      "ticket_disc": number or null (Ticket Disc column),
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

LDC "CASH TICKET DETAIL" LAYOUT — READ VERY CAREFULLY:

The document has a HEADER section and a DETAIL section. The numbers in these sections mean DIFFERENT things:

HEADER (top of document):
- "Cash Ticket Detail" + a large number (often highlighted in yellow) = the SETTLEMENT NUMBER (e.g. 571040066092)
- This is NOT a contract number or ticket number.

ASSEMBLY SECTION (below header):
- Assembly # = an internal assembly/shipment number (e.g. 571020120184). NOT a ticket number.
- Contract = the CONTRACT NUMBER (e.g. 8008913). This goes in contract_number.
- The Assembly row shows: Assembly Date, Gross Qty, Dockage, Net Qty, Gross Amt, Discounts, Program Chgs, Net Amount

PROGRAM CHARGES section:
- Shows deductions like "SK DEV ASSN" (category: checkoff), "TRUCKING" (category: freight)
- Each has a Rate and Amount. Extract these into deductions_summary with negative amounts.

PER-TICKET DETAIL ROWS (lower section, after "Ticket Number | Date | Split % | Gross | Dockage | Net | Ticket Disc"):
- Each ticket has a 10-digit Ticket Number (e.g. 5717345236, 5717348284, etc.)
- These are the ACTUAL weigh scale ticket numbers — use these as ticket_number
- Below each ticket row are grading details (TDK, DGR, DMG, MOIST, HTD, LIN, OLE, OL values)
- Then Dockage and Disc Chgs rows
- Finally PriceQty and Price columns at the right

CRITICAL RULES:
1. The settlement_number is the highlighted number at the TOP (e.g. 571040066092), NOT the Contract #
2. The contract_number is the "Contract" field in the Assembly section (e.g. 8008913), NOT the settlement number
3. Ticket numbers are 10-digit numbers in the per-ticket detail rows (e.g. 5717345236), NOT the Assembly # or Contract #
4. Do NOT create a line entry for the Assembly # or Contract # — only for actual ticket rows
5. Weights in the per-ticket rows are in MT
6. MULTI-CONTRACT SETTLEMENTS: A single LDC settlement may contain MULTIPLE Assembly sections, each with a DIFFERENT Contract number. For example, Assembly 571020120184 / Contract 8008913 and Assembly 571020124557 / Contract 8011244 on the same settlement. Each ticket line MUST include the contract_number from its parent Assembly. The top-level contract_number should be the first/primary contract, but every line must carry its own contract_number.

Extract ALL ticket rows across ALL pages. Return ONLY valid JSON, no extra text.`,

  g3: `You are extracting data from a G3 Canada Limited grain settlement PDF. This document may have TWO different formats:

FORMAT A — "EFT Document" + rotated "Settlement Document" pages:
- Page 1 is an "EFT Document - Payable in CAD" summary showing payment info. The "TICKET / SOURCE NBR" column on this page is a BATCH reference number — it is NOT the per-ticket weigh scale number. IGNORE this number for ticket_number.
- Subsequent pages are "SETTLEMENT DOCUMENT" detail pages (may be rotated 90°). Each page shows 2-3 individual ticket blocks with Receipt Number, Receipt Date, Product, weights, deductions, contract info.

FORMAT B — Clean tabular "SETTLEMENT DOCUMENT" pages:
- Each page shows the G3 header with Settle Date, Cheque/EFT Nbr, Payment Amount, Location, Grain.
- Ticket rows appear in a table with columns: Receipt Date | Receipt Number | Product | Gross WT | Vehicle Weight | Grain Unloaded | Dock % | Dock WT | Moist % | Net MT | Split Percent | Price / Net MT | Gross Amt Payable
- Deductions listed per ticket (Type, Rate, Net Deduction)
- Pricing info (Apply Type, Contract Nbr, Net of Discounts) per ticket
- Last page has CONTRACT summary and DEDUCTIONS summary tables

Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (the Cheque / EFT Nbr from the header, e.g. '789', '900', '882'. For EFT format, look for 'Payment Nbr' on the EFT page or 'Settle Doc Nbr' — use the settlement # like '1521082')",
  "settlement_date": "YYYY-MM-DD (the Settle Date or Payment Date from the header)",
  "buyer": "G3 Canada Limited",
  "contract_number": "string or null (the primary contract number — from the CONTRACT summary on the last page or the Contract Nbr column per ticket. If multiple contracts, use the most common one. Format: '304141', '307573', '317801')",
  "commodity": "string (from the Grain field or Product column — e.g. 'Western Red Spring', 'Durum'. Product column shows grade like '1 CWRS 13.5' or '2 CWAD 13.3')",
  "location": "string or null (from Location field — e.g. 'Melfort', 'Pasqua')",
  "total_gross_amount": number (from the Gross Amt on the CONTRACT summary, or sum of all ticket Gross Amt Payable values),
  "total_net_amount": number (the Net Settlement amount from the summary),
  "settlement_gross": number or null (the Gross Amt from CONTRACT summary — before deductions),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string — MUST be the Receipt Number (the highlighted number, e.g. '51828', '53762', '204614'). This is the weigh scale ticket number. See CRITICAL RULES below.",
      "receipt_number": "string (same as ticket_number — the Receipt Number)",
      "load_order": "string or null (the Load Order # if visible, e.g. '1436221')",
      "delivery_date": "YYYY-MM-DD (from Receipt Date column — format is MM/DD/YY, convert to YYYY-MM-DD)",
      "contract_number": "string or null (per-ticket Contract Nbr — e.g. '304141', '307573')",
      "product": "string or null (the Product column, e.g. '1 CWRS 13.5', '2 CWAD 13.3')",
      "gross_weight_mt": number or null (Gross WT),
      "vehicle_weight": number or null (Vehicle Weight),
      "grain_unloaded": number or null (Grain Unloaded — highlighted in yellow),
      "net_weight_mt": number or null (Net MT),
      "grade": "string or null (extract from Product field — e.g. '1 CWRS', '2 CWAD')",
      "moisture_pct": number or null (Moist %),
      "dockage_pct": number or null (Dock %),
      "dockage_wt": number or null (Dock WT),
      "split_percent": number or null (Split Percent — usually 100.000),
      "price_per_mt": number or null (Price / Net MT),
      "line_gross": number or null (Gross Amt Payable),
      "line_net": number or null (Net of Discounts),
      "pricing_type": "string or null (Apply Type — 'Fixed Prc', 'Flat', 'Spot')",
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

CRITICAL RULES FOR G3:
1. The ticket_number MUST be the "Receipt Number" — this is the weigh scale ticket number that matches the trucker's scale ticket (e.g. 51828, 53762, 53785, 204614, 201425, 203203).
2. DO NOT use the "TICKET / SOURCE NBR" from the EFT summary page — that is a batch reference number (e.g. 15722) that is the SAME for all lines. It is NOT a per-ticket identifier.
3. DO NOT use the Load Order # as the ticket number — those are G3's internal order tracking numbers (e.g. 1436221, 1440931).
4. Each ticket block on the settlement detail pages has its OWN unique Receipt Number. Extract EVERY ticket individually.
5. Some tickets may have the same Receipt Number but different pricing (e.g. a split between "Flat" contract pricing and "Spot" pricing). These are sub-allocations of the SAME physical load — combine them into ONE line using the Receipt Number, summing the gross amounts and net amounts, and noting both contract numbers.
6. Deduction types: SK Wht C/SK Wht Develop Com = checkoff (wheat), SK Durum/SK Durum Develop Com = checkoff (durum), Drying/DryRebC = drying, SHR_BKI = quality (shrinkage/breakage), GFRHTS/FRHTS = freight, MIL/TSPTD/HVK/TWT/FUS DMC/ERG/SFLY MD/SEVMDG/SEVSPTL = quality (grading factors). The per-ticket "Net Deduction" is the total deduction for that ticket.
7. The last page typically shows: Total Number of Loads, Total Net Units (MT), CONTRACT summary (Contract Nbr, Gross Amt Payable), and DEDUCTIONS summary (Discount name, Discount Amt, Net Settlement). Extract these into deductions_summary.
8. Weights are in MT (metric tonnes).

Extract ALL ticket rows across ALL pages. Return ONLY valid JSON, no extra text.`,

  wilde_bros: `You are extracting data from a Wilde Bros. Ag Trading grain settlement PDF. This is a QuickBooks "Bill Payment Stub" with one or more attached "Bill" detail pages. The document represents ONE payment (cheque/debit) that may cover multiple Bills. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (use the contract Ref. No. + Cheque Date, e.g. 'P25-7292E-20260206')",
  "settlement_date": "YYYY-MM-DD (the Cheque Date from the Bill Payment Stub header)",
  "buyer": "Wilde Bros. Ag Trading",
  "contract_number": "string (the Ref. No. from the Bill pages, e.g. 'P25-7292E')",
  "commodity": "string (from the Item column on Bill pages — e.g. 'Barley' from 'Barley P')",
  "total_gross_amount": number (the Cheque Amount from the Payment Stub — this is the total payment),
  "total_net_amount": number (same as total_gross_amount — the cheque amount IS the net after per-line deductions),
  "settlement_gross": number or null (sum of all 'Barley P' line amounts BEFORE shrinkage and commission deductions),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|shrinkage|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string (the ticket number from the description — e.g. '15-10397' from 'Barley P 15-10397, 01/20/2026...')",
      "delivery_date": "YYYY-MM-DD (the date from the description — e.g. '01/20/2026' → '2026-01-20')",
      "contract_number": "string or null (the Ref. No.)",
      "gross_weight_mt": number (the Qty from the 'Barley P' row — this is gross MT before shrinkage),
      "net_weight_mt": number (gross_weight_mt minus the shrinkage Qty, e.g. 43.45 - 0.4345 = 43.0155)",
      "grade": "string or null",
      "price_per_mt": number (the Cost column, e.g. 241.13)",
      "price_per_bu": number or null (extract from description if present, e.g. '$5.25/bu')",
      "line_gross": number (the Amount from the 'Barley P' row — gross before shrinkage/commission)",
      "line_net": number (sum of Barley P amount + Shrinkage P amount + Sask Barley Com amount for this ticket)",
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

CRITICAL LAYOUT — Wilde Bros QB Bills have THREE rows per ticket:
1. "Barley P" row: ticket#, date, price breakdown in Description; Qty = gross MT; Cost = $/MT; Amount = gross $
2. "Shrinkage P" row: "Less 1% shrinkage"; Qty = negative (1% of gross MT); Amount = negative
3. "Sask Barley Com" row: commission checkoff; Qty = gross MT; Cost = -$1.06/MT; Amount = negative

Group these three rows into ONE line per ticket. The ticket_number comes from the "Barley P" description (e.g. "15-10397").

The Bill Payment Stub (page 1) shows the total Cheque Amount and lists all Bills being paid. Subsequent pages are individual Bill details with per-ticket line items. Combine ALL tickets from ALL Bills into one flat lines array.

For deductions_summary, aggregate ALL shrinkage deductions (category: "shrinkage") and ALL Sask Barley Commission deductions (category: "checkoff") across all lines. Return ONLY valid JSON, no extra text.`,

  mb_agri: `You are extracting data from an MB Agri-Food Innovations broker completion receipt. This is typically a printed Outlook email from Mark Boryski containing a structured cost breakdown table. It represents a LUMP SUM settlement — no per-ticket detail. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (the Contract Number, e.g. 'TM 631974-1,2,3' or 'TM 641524')",
  "settlement_date": "YYYY-MM-DD (the email Date field)",
  "buyer": "MB Agri-Food Innovations",
  "end_buyer": "string (the 'Buyer' field in the table — the actual international buyer, e.g. 'Almacenes Vaca', 'Empacadora El Fresno')",
  "contract_number": "string (the Contract Number from the table, e.g. 'TM 631974-1,2,3')",
  "c2_contract_number": "string or null (if a P-series number appears in the email subject or body, e.g. 'P-008-1,2,3' or 'P-017')",
  "commodity": "string (from the Commodity field — e.g. 'Eston', 'Canary')",
  "invoice_number": "string or null (the Invoice Number field if present)",
  "total_gross_amount": number (the 'Total Value' or 'Total Received' in USD × FX rate = CAD gross, OR compute as Grower Price + all CAD deductions)",
  "total_net_amount": number (the 'Grower Price' — this is what C2 Farms actually receives in CAD)",
  "settlement_gross": number or null (the 'Total CAD Cost' — total CAD value before margin split)",
  "mt_shipped": number (the 'MT Shipped' value),
  "price_usd_per_mt": number (the 'Price USD/mt' value),
  "fx_rate": number (the Foreign Exchange rate, e.g. 1.4067),
  "total_value_usd": number (the 'Total Value' or 'Total Received' in USD),
  "deductions_summary": [{"name": "string", "amount": number (negative — these are costs deducted from gross), "gst": number or null, "pst": number or null, "category": "freight|commission|processing|inspection|other", "vendor": "string or null (the vendor name from the right column, e.g. 'LIT', 'Cotecna', 'CFIA')"}],
  "margin": {"total": number, "trading_margin_1": number, "trading_margin_2": number},
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": null,
      "delivery_date": null,
      "gross_weight_mt": number (MT Shipped),
      "net_weight_mt": number (MT Shipped — same, no shrinkage applied at this level),
      "price_per_mt": number (Grower Price / MT Shipped = effective CAD $/MT to grower),
      "line_gross": number (Total Value USD × FX rate in CAD),
      "line_net": number (Grower Price),
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

MB AGRI COST BREAKDOWN — The table has two sections:
1. **USD Costs**: Freight, Brokerage → subtotal as "Total USD Cost"
2. **CAD Costs**: Processing ($/mt × MT), Rail Freight, Sampling/Testing, CFIA testing, CFIA Cert., Documents, Courier, Bank Charges

Category mapping for deductions_summary:
- Freight (USD) → category: "freight"
- Brokerage (USD) → category: "commission"
- Processing → category: "processing", vendor from table (e.g. "LIT")
- Rail Freight → category: "freight", vendor from table (e.g. "CP / SSR")
- Sampling/Testing → category: "inspection", vendor from table
- CFIA testing/Cert. → category: "inspection", vendor: "CFIA"
- Documents → category: "other", vendor from table
- Courier → category: "other", vendor from table (e.g. "Purolator")
- Bank Charges → category: "other", vendor from table (e.g. "BMO")

Convert USD costs to CAD using the FX rate before putting in deductions_summary (all amounts should be in CAD, negative).
The "Margin" and "Trading Margin 1/2" are the broker's cut — extract into the margin object but do NOT include in deductions_summary.

NOTE: There are no per-ticket lines. Create ONE line representing the entire shipment. The email body may contain notes about disputes or partial payments — capture these in a "notes" field if present.

Return ONLY valid JSON, no extra text.`,

  cenovus: `You are extracting data from a Cenovus Energy grain settlement PDF. Cenovus settlements originate as "Husky Energy Mktg Partner" (Husky merged into Cenovus in 2021). The plant is LLOYDMINSTER ETHANOL. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string (the Invoice Document number from the 'Cash Purchase Ticket Payment Information' page — e.g. '5205144045', '5205141723'. This is also the 'Invoice Ref.' on the Payment Remittance page.)",
  "settlement_date": "YYYY-MM-DD (the Payment Date — format is DD.MM.YYYY, convert to YYYY-MM-DD)",
  "buyer": "Cenovus Energy",
  "document_number": "string or null (the Document No. from the Payment Remittance page — e.g. '1100002840'. This is Cenovus's internal document reference.)",
  "contract_number": "string or null (the Document No. — e.g. '1100002840'. Cenovus uses Document No. as the contract/PO reference.)",
  "purchase_order": "string or null (the Purchase Order number from the Cash Purchase Ticket page — e.g. '8401871648')",
  "commodity": "string (from the Material Description column — e.g. 'FEED STOCK, ETHANOL,WHEAT'. Map to: 'SWW' or 'Feed Wheat' if it says WHEAT/ETHANOL, 'Barley' if BARLEY, 'Canola' if CANOLA)",
  "total_gross_amount": number (sum of all material line Net Amounts from page 2 — this is gross before discounts on page 3),
  "total_net_amount": number (the Total Payment Amount from page 1, or 'Total Including Tax CAD' from page 2),
  "settlement_gross": number or null (sum of material line Net Amounts BEFORE page 3 discounts),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string — MUST be the BOL number (e.g. '165263', '165242'). See CRITICAL RULES below.",
      "truck_number": "string or null (the Truck column — e.g. '2142617')",
      "delivery_date": "YYYY-MM-DD (the Receipt Date — format is YYYY.MM.DD, convert to YYYY-MM-DD)",
      "contract_number": "string or null",
      "gross_weight_mt": number or null,
      "net_weight_mt": number (the Net Qty in TO/tonnes from the MAIN material line — NOT the small adjustment line)",
      "grade": "string or null",
      "moisture_pct": number or null,
      "dockage_pct": number or null,
      "price_per_mt": number or null (the Gr. Price — gross price per MT, e.g. 275.00)",
      "net_price_per_mt": number or null (the Net Price — after per-unit discount, e.g. 273.91)",
      "line_gross": number or null (the Net Amount from the MAIN material line)",
      "line_net": number or null,
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

CENOVUS SETTLEMENT LAYOUT — READ CAREFULLY:

The document has 3 pages (or 2 pages if no discounts):

PAGE 1 — "Payment Remittance":
- Header table: Date | Document No. | Invoice Ref. | Invoice Amount | Discount | Amount Paid | Currency
- Vendor info, Payment Document No, Payment Date, Total Payment Amount
- The Invoice Ref. is the SETTLEMENT NUMBER (e.g. 5205144045)
- The Document No. is the CONTRACT/DOCUMENT reference (e.g. 1100002840)

PAGE 2 — "Cash Purchase Ticket Payment Information":
- Header: Invoice Document (same as Invoice Ref), FI Document, Purchase Order, Payment info
- Material lines table: Material Description | BOL | Truck | Receipt Date | Net Qty UM | Gr. Price | Net Price | Net Amount
- IMPORTANT: Each physical load has TWO material rows:
  1. MAIN line: "FEED STOCK, ETHANOL,WHEAT" with BOL (e.g. 165263), full Net Qty (e.g. 43.576 TO), real prices (275.00/273.91), real amount (11935.90)
  2. ADJUSTMENT line: "FEED STOCK, ETHANOL,WHEAT - A165263" (note the "A" prefix on BOL) — tiny qty (e.g. 0.664 TO) at $0.10 price = $0.07. This is a weight adjustment/rounding line.
- COMBINE both lines into ONE line entry: use the BOL from the main line as ticket_number, use the main line's Net Qty as net_weight_mt, and SUM both Net Amounts for line_gross.
- Tax section shows 0.00% GST / 0.00% PST (tax exempt grain)

PAGE 3 — "Cash Purchase Ticket Discount Information" (may not exist if no discounts):
- Same header info as page 2
- Discount lines: Discount Description | GR Document | BOL | Truck | Receipt Date | Quantity | Disc Price | Amount
- Common discounts: "AB WHEAT COMMISSION" (Alberta Wheat Commission checkoff — category: checkoff)
- The Disc Price is per-MT (e.g. $1.09/MT), Amount is total discount for that load
- Extract each discount into deductions_summary with NEGATIVE amounts

CRITICAL RULES:
1. ticket_number MUST be the BOL number from page 2 (e.g. 165263, 165242, 165187, 165205, 165160). These are 6-digit numbers.
2. The Truck number (e.g. 2142617) is the truck identifier, NOT the ticket number.
3. The Document No. from page 1 (e.g. 1100002840) is a contract reference, NOT a ticket number.
4. COMBINE the main material line and its "A" adjustment line into a single line entry per BOL.
5. For multi-ticket settlements (2+ loads on one settlement), extract EACH load as a separate line.
6. Weights are in TO (tonnes = metric tonnes).
7. The difference between Gr. Price and Net Price (e.g. 275.00 - 273.91 = 1.09) equals the AB WHEAT COMMISSION rate.

Extract ALL ticket rows across ALL pages. Return ONLY valid JSON, no extra text.`,

  unknown: `You are extracting data from a grain settlement PDF. The buyer format is unknown. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string",
  "settlement_date": "YYYY-MM-DD",
  "buyer": "string",
  "contract_number": "string or null",
  "commodity": "string",
  "total_gross_amount": number or null,
  "total_net_amount": number or null,
  "settlement_gross": number or null (total gross before all deductions),
  "deductions_summary": [{"name": "string", "amount": number (negative for deductions), "gst": number or null, "pst": number or null, "category": "checkoff|drying|quality|freight|storage|commission|levy|premium|other"}],
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string or null (the weigh scale ticket number — the number matching the trucker's scale ticket, NOT the buyer's internal receipt number)",
      "delivery_date": "YYYY-MM-DD or null",
      "gross_weight_mt": number or null,
      "net_weight_mt": number or null,
      "grade": "string or null",
      "price_per_mt": number or null,
      "price_per_bu": number or null,
      "line_gross": number or null,
      "line_net": number or null,
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

Extract as much data as possible. Look for settlement/purchase number, dates, per-ticket or per-load detail rows, weights (convert kg to MT if needed), pricing. Look for a deduction/adjustment summary section (often near the bottom or last page) showing levies, checkoffs, drying charges, quality discounts, freight, GST/PST, and net settlement amount. Extract these into deductions_summary. Return ONLY valid JSON, no extra text.`,
};

/**
 * Detect buyer format from PDF content using a quick Haiku call (cheap + fast).
 * Returns { format, usage }.
 */
async function detectBuyerFormat(pdfBase64) {
  try {
    const client = await getAnthropicClient();
    const model = MODELS.detection;
    const response = await client.messages.create({
      model,
      max_tokens: 50,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          {
            type: 'text',
            text: 'What grain company issued this settlement document? Reply with ONLY one word: "cargill", "bunge", "jgl", "richardson", "gsl", "ldc", "g3", "wilde_bros", "mb_agri", "cenovus", or "unknown". Note: Louis Dreyfus Company = "ldc". G3 Canada Limited = "g3". Wilde Bros. Ag Trading (QuickBooks Bill Payment Stub) = "wilde_bros". MB Agri-Food Innovations / Mark Boryski broker email completion receipt = "mb_agri". Cenovus Energy / Husky Energy Mktg Partner (Lloydminster Ethanol) = "cenovus".',
          },
        ],
      }],
    });

    const usage = computeUsage(model, response);
    const answer = response.content[0]?.text?.trim().toLowerCase();
    const format = ['cargill', 'bunge', 'jgl', 'richardson', 'gsl', 'ldc', 'g3', 'wilde_bros', 'mb_agri', 'cenovus'].includes(answer) ? answer : 'unknown';
    return { format, usage };
  } catch (err) {
    const classified = classifyApiError(err);
    // For detection, we can fall back to unknown — but surface real auth/billing errors
    if (['NO_API_KEY', 'INVALID_API_KEY', 'INSUFFICIENT_CREDITS'].includes(classified.code)) {
      throw Object.assign(new Error(classified.message), { code: classified.code });
    }
    return { format: 'unknown', usage: null };
  }
}

/**
 * Fetch active format hints for a given buyer format.
 * These are admin-provided correction instructions stored per-buyer.
 */
async function getFormatHints(farmId, buyerFormat) {
  const hints = await prisma.settlementFormatHint.findMany({
    where: { farm_id: farmId, buyer_format: buyerFormat, is_active: true },
    orderBy: { created_at: 'desc' },
    take: 10,
  });
  return hints;
}

/**
 * Build the full extraction prompt, including any admin-provided format hints.
 */
function buildExtractionPrompt(buyerFormat, hints = []) {
  let prompt = EXTRACTION_PROMPTS[buyerFormat] || EXTRACTION_PROMPTS.unknown;

  if (hints.length > 0) {
    const hintsBlock = hints.map((h, i) => `${i + 1}. ${h.hint_text}`).join('\n');
    prompt += `\n\nADDITIONAL CORRECTION INSTRUCTIONS FROM ADMINISTRATOR (apply these rules carefully):\n${hintsBlock}`;
  }

  return prompt;
}

/**
 * Extract settlement data from a PDF buffer using Claude Vision.
 * Returns { extraction, buyerFormat, usage } where usage includes token counts and cost.
 */
export async function extractSettlementFromPdf(pdfBuffer, forceBuyerFormat = null, farmId = null) {
  const pdfBase64 = pdfBuffer.toString('base64');
  const usageBreakdown = [];

  // Detect or use forced format
  let buyerFormat = forceBuyerFormat;
  if (!buyerFormat) {
    const detection = await detectBuyerFormat(pdfBase64);
    buyerFormat = detection.format;
    if (detection.usage) usageBreakdown.push({ step: 'format_detection', ...detection.usage });
  }

  // Fetch admin-provided correction hints for this buyer format
  const hints = farmId ? await getFormatHints(farmId, buyerFormat) : [];
  const prompt = buildExtractionPrompt(buyerFormat, hints);
  const model = MODELS.extraction;

  let response;
  try {
    const client = await getAnthropicClient();
    response = await client.messages.create({
      model,
      max_tokens: 16384,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: prompt },
        ],
      }],
    });
  } catch (err) {
    const classified = classifyApiError(err);
    throw Object.assign(new Error(classified.message), {
      code: classified.code,
      usage: usageBreakdown.length ? usageBreakdown : undefined,
    });
  }

  const extractionUsage = computeUsage(model, response);
  usageBreakdown.push({ step: 'extraction', ...extractionUsage });

  // Aggregate totals
  const totalUsage = {
    steps: usageBreakdown,
    total_input_tokens: usageBreakdown.reduce((s, u) => s + (u.input_tokens || 0), 0),
    total_output_tokens: usageBreakdown.reduce((s, u) => s + (u.output_tokens || 0), 0),
    total_tokens: usageBreakdown.reduce((s, u) => s + (u.total_tokens || 0), 0),
    total_estimated_cost_usd: Math.round(usageBreakdown.reduce((s, u) => s + (u.estimated_cost_usd || 0), 0) * 10000) / 10000,
  };

  // Check if response was truncated
  if (response.stop_reason === 'max_tokens') {
    throw Object.assign(
      new Error('Extraction was cut short — document may be too complex. Try uploading fewer pages or a cleaner PDF.'),
      { code: 'TRUNCATED', usage: totalUsage }
    );
  }

  const text = response.content[0]?.text || '';

  // Parse JSON from response (handle markdown code blocks)
  let extraction;
  try {
    extraction = parseJsonResponse(text);
  } catch {
    throw Object.assign(
      new Error(`Failed to parse extraction result. Claude returned unexpected format.`),
      { code: 'PARSE_ERROR', usage: totalUsage, raw_response: text.substring(0, 500) }
    );
  }

  return { extraction, buyerFormat, usage: totalUsage };
}

/**
 * Post-process AI-extracted ticket numbers.
 * Settlement PDFs often show multiple ID numbers per ticket line:
 *   - Station/Receipt # (buyer's internal, 9+ digits)
 *   - Load # (buyer's internal)
 *   - Weigh # (scale ticket number, typically 5-6 digits, matches Traction Ag)
 *
 * The AI frequently grabs the wrong number. This function ensures ticket_number
 * contains the weigh scale number by checking for shorter alternative numbers.
 */
function postProcessTicketNumbers(lines, buyerFormat) {
  return lines.map(line => {
    const tn = String(line.ticket_number || '');

    // Richardson: if weigh_number was extracted separately, ALWAYS prefer it as ticket_number.
    // The weigh_number field is the definitive weigh scale number — even if the AI
    // correctly put it in ticket_number too, this ensures consistency.
    if (buyerFormat === 'richardson' && line.weigh_number) {
      const wn = String(line.weigh_number);
      if (/^\d+$/.test(wn) && wn.length <= 7 && wn !== tn) {
        return {
          ...line,
          ticket_number: wn,
          buyer_receipt_number: tn,
        };
      }
    }

    // Check alternative fields that might contain the weigh scale number
    const alternatives = [
      line.load_number,
      line.weigh_number,
      line.scale_ticket,
    ].filter(Boolean).map(String);

    // If ticket_number is a long internal number (8+ digits) and there's a shorter
    // alternative (5-6 digits), the shorter one is likely the weigh scale number
    if (tn.length >= 8 && /^\d+$/.test(tn)) {
      const shorter = alternatives.find(a => /^\d+$/.test(a) && a.length >= 5 && a.length <= 7);
      if (shorter) {
        return {
          ...line,
          ticket_number: shorter,
          buyer_receipt_number: tn,
        };
      }
    }

    // Also handle: if ticket_number is long and load_number is shorter, swap
    // even without strict digit-length checks — for Richardson specifically
    if (buyerFormat === 'richardson' && tn.length >= 8 && alternatives.length > 0) {
      const best = alternatives.find(a => a.length < tn.length) || alternatives[0];
      if (best && best.length < tn.length) {
        return {
          ...line,
          ticket_number: best,
          buyer_receipt_number: tn,
        };
      }
    }

    // GSL: The GSL Reference Number is the delivery ticket number.
    // The Doc. No. / A/P Invoice # is GSL's internal number — do NOT use as ticket_number.
    // If the AI accidentally put the A/P Invoice # in ticket_number, swap it.
    if (buyerFormat === 'gsl') {
      const gslRef = String(line.supplier_reference || line.gsl_reference_number || '');
      const apInv = String(line.ap_invoice_number || '');
      // If ticket_number matches the A/P invoice (wrong), swap with GSL reference
      if (apInv && tn === apInv && gslRef && gslRef !== apInv) {
        return {
          ...line,
          ticket_number: gslRef,
          buyer_receipt_number: apInv,
        };
      }
    }

    // LDC: Ticket numbers should be 10-digit weigh scale numbers (5717xxxxxx pattern).
    // If the AI accidentally put the contract # (7 digits, e.g. 8008913) or assembly #
    // (12 digits, e.g. 571020120184) as ticket_number, filter them out.
    if (buyerFormat === 'ldc') {
      // Skip lines where ticket_number is clearly a contract or assembly number, not a ticket
      const assembly = String(line.assembly_number || '');
      const contract = String(line.contract_number || '');
      if (tn && (tn === assembly || tn === contract)) {
        // This line is the assembly/contract row misidentified as a ticket — skip it
        return { ...line, ticket_number: null, _skip: true };
      }
    }

    // G3: The Receipt Number is the weigh scale ticket number.
    // If the AI accidentally used the Load Order # (7-digit, e.g. 1436221) or the
    // EFT batch "TICKET / SOURCE NBR" (same for all lines, e.g. 15722), fix it.
    if (buyerFormat === 'g3') {
      const receiptNum = String(line.receipt_number || '');
      // If ticket_number is a Load Order # (7 digits starting with 14xxxxx) and
      // receipt_number exists, swap to receipt_number
      if (receiptNum && /^\d{5,6}$/.test(receiptNum) && tn !== receiptNum) {
        return {
          ...line,
          ticket_number: receiptNum,
          buyer_receipt_number: tn,
        };
      }
      // If all ticket numbers in the batch are the same (EFT batch ref), the AI
      // grabbed the wrong field. We can't fix this in post-processing per-line,
      // but the prompt should handle it. At least ensure receipt_number propagates.
      if (receiptNum && tn === receiptNum) {
        // Already correct — receipt_number matches ticket_number
        return line;
      }
    }

    // Cenovus: The BOL is the weigh scale ticket number (6-digit, e.g. 165263).
    // The Truck number (7-digit, e.g. 2142617) is the truck identifier, NOT the ticket.
    // The AI frequently puts Truck in ticket_number and BOL in truck_number — swap them.
    if (buyerFormat === 'cenovus') {
      const truckNum = String(line.truck_number || '');
      // If ticket_number looks like a truck ID (7 digits, 21xxxxx pattern) and
      // truck_number looks like a BOL (6 digits), they're swapped
      if (truckNum && /^\d{5,6}$/.test(truckNum) && /^\d{7}$/.test(tn)) {
        return {
          ...line,
          ticket_number: truckNum,
          truck_number: tn,
          buyer_receipt_number: tn,
        };
      }
      // Also check: if ticket_number is long (7+ digits) and there's a bol field
      const bol = String(line.bol || line.bol_number || '');
      if (bol && /^\d{5,6}$/.test(bol) && tn.length >= 7) {
        return {
          ...line,
          ticket_number: bol,
          buyer_receipt_number: tn,
        };
      }
    }

    // Bunge: The correct ticket_number is "BOL or Car #" (the weigh scale number).
    // If the AI extracted a bol_or_car field, always prefer it as ticket_number.
    // The Receipt # is Bunge's internal receipt — store it separately.
    if (buyerFormat === 'bunge') {
      const bol = String(line.bol_or_car || line.bol_number || '');
      if (/^\d+$/.test(bol) && bol.length >= 4 && bol !== tn) {
        return {
          ...line,
          ticket_number: bol,
          buyer_receipt_number: tn,
        };
      }
      // Fallback: if receipt_number was extracted and ticket_number looks like it,
      // and there's a shorter number in another field, prefer the shorter one
      const rn = String(line.receipt_number || '');
      if (rn === tn && line.delivery_number) {
        // ticket_number is the receipt — wrong. Check if any other field has the BOL
        // Can't recover without BOL, but flag it
      }
    }

    return line;
  });
}

/**
 * Save extracted settlement data to the database.
 * Creates Settlement + SettlementLine records.
 */
export async function saveSettlement(farmId, extraction, buyerFormat, { pdfUrl = null, usage = null, batchId = null, batchCustomId = null } = {}) {
  // Look up counterparty
  const buyerName = extraction.buyer;
  let counterparty = null;
  if (buyerName) {
    counterparty = await prisma.counterparty.findFirst({
      where: {
        farm_id: farmId,
        OR: [
          { name: { contains: buyerName, mode: 'insensitive' } },
          { short_code: { equals: buyerName.toUpperCase().replace(/\s+/g, '').substring(0, 10) } },
        ],
      },
    });
  }

  // Look up marketing contract
  let marketingContract = null;
  if (extraction.contract_number) {
    marketingContract = await prisma.marketingContract.findFirst({
      where: {
        farm_id: farmId,
        contract_number: extraction.contract_number,
      },
    });
  }

  const settlement = await prisma.settlement.create({
    data: {
      farm_id: farmId,
      counterparty_id: counterparty?.id || null,
      marketing_contract_id: marketingContract?.id || null,
      ai_batch_id: batchId || null,
      batch_custom_id: batchCustomId || null,
      extraction_status: 'completed',
      settlement_number: extraction.settlement_number || `UNK-${Date.now()}`,
      settlement_date: extraction.settlement_date ? new Date(extraction.settlement_date) : null,
      total_amount: extraction.total_net_amount || extraction.total_gross_amount || null,
      settlement_gross: extraction.settlement_gross || extraction.total_gross_amount || null,
      deductions_summary: extraction.deductions_summary || null,
      currency: extraction.currency || 'CAD',
      status: 'pending',
      buyer_format: buyerFormat,
      source_pdf_url: pdfUrl,
      extraction_json: extraction,
      usage_json: usage || null,
    },
  });

  // Post-process: fix ticket numbers when AI grabs internal IDs instead of weigh scale numbers
  let lines = postProcessTicketNumbers(extraction.lines || [], buyerFormat).filter(l => !l._skip);

  // Cenovus: merge adjustment lines into their parent.
  // Each physical load has a MAIN line + small "A" adjustment line (same ticket_number, tiny qty at $0.10).
  // Combine them into a single line, summing line_gross/line_net.
  if (buyerFormat === 'cenovus' && lines.length > 1) {
    const merged = [];
    const seen = new Set();
    for (const line of lines) {
      const tn = String(line.ticket_number || '');
      if (seen.has(tn)) continue; // already merged as an adjustment
      // Find adjustment lines: same ticket_number, very small qty (< 1 MT), price <= 0.10
      const adjustments = lines.filter(l =>
        l !== line &&
        String(l.ticket_number || '') === tn &&
        (l.net_weight_mt || 0) < 1 &&
        (l.price_per_mt || 0) <= 0.10
      );
      if (adjustments.length > 0) {
        const adjGross = adjustments.reduce((s, a) => s + (a.line_gross || 0), 0);
        merged.push({
          ...line,
          line_gross: (line.line_gross || 0) + adjGross,
          line_net: line.line_net != null ? (line.line_net || 0) + adjGross : null,
        });
        adjustments.forEach(a => seen.add(String(a.ticket_number || '')));
      } else {
        merged.push(line);
      }
      seen.add(tn);
    }
    lines = merged;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await prisma.settlementLine.create({
      data: {
        settlement_id: settlement.id,
        line_number: line.line_number || i + 1,
        ticket_number_on_settlement: line.ticket_number || null,
        contract_number: line.contract_number || extraction.contract_number || null,
        delivery_date: line.delivery_date ? new Date(line.delivery_date) : null,
        commodity: line.commodity || extraction.commodity || null,
        grade: line.grade || null,
        gross_weight_mt: line.gross_weight_mt || null,
        net_weight_mt: line.net_weight_mt || null,
        price_per_mt: line.price_per_mt || null,
        price_per_bu: line.price_per_bu || null,
        deductions_json: line.deductions || null,
        line_gross: line.line_gross || null,
        line_net: line.line_net || null,
        match_status: 'unmatched',
      },
    });
  }

  // Fetch complete settlement with lines
  return prisma.settlement.findUnique({
    where: { id: settlement.id },
    include: {
      lines: { orderBy: { line_number: 'asc' } },
      counterparty: true,
      marketing_contract: { include: { commodity: true } },
    },
  });
}

// ─── Batch API (50% cheaper) ────────────────────────────────────────────────

/**
 * Queue multiple settlement PDFs for batch extraction.
 * Each item: { buffer: Buffer, filename: String, buyerFormat?: String }
 *
 * 1. Detect buyer format for each (instant Haiku calls)
 * 2. Create AiBatch + placeholder Settlement records
 * 3. Submit to Anthropic Batch API
 * 4. Return batch info for polling
 */
export async function queueBatchExtraction(farmId, files) {
  const client = await getAnthropicClient();

  // Step 1: Detect buyer format for each file (cheap Haiku calls in parallel)
  const prepared = await Promise.all(files.map(async (f, idx) => {
    const pdfBase64 = f.buffer.toString('base64');
    let buyerFormat = f.buyerFormat;
    let detectionUsage = null;
    if (!buyerFormat) {
      const detection = await detectBuyerFormat(pdfBase64);
      buyerFormat = detection.format;
      detectionUsage = detection.usage;
    }
    return { pdfBase64, buyerFormat, filename: f.filename, index: idx, detectionUsage };
  }));

  // Step 2: Create AiBatch record
  const aiBatch = await prisma.aiBatch.create({
    data: {
      farm_id: farmId,
      status: 'queued',
      total_requests: prepared.length,
    },
  });

  // Step 3: Create placeholder Settlement records
  const settlements = [];
  for (const item of prepared) {
    const settlement = await prisma.settlement.create({
      data: {
        farm_id: farmId,
        ai_batch_id: aiBatch.id,
        batch_custom_id: `settlement-${aiBatch.id}-${item.index}`,
        extraction_status: 'queued',
        settlement_number: `BATCH-${aiBatch.id.substring(0, 8)}-${item.index}`,
        status: 'pending',
        buyer_format: item.buyerFormat,
        notes: `Batch extraction from ${item.filename}`,
      },
    });
    settlements.push({ ...item, settlementId: settlement.id });
  }

  // Step 4: Build and submit Anthropic batch request
  const batchRequests = settlements.map(item => {
    const prompt = EXTRACTION_PROMPTS[item.buyerFormat] || EXTRACTION_PROMPTS.unknown;
    return {
      custom_id: `settlement-${aiBatch.id}-${item.index}`,
      params: {
        model: MODELS.extraction,
        max_tokens: 16384,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'document',
              source: { type: 'base64', media_type: 'application/pdf', data: item.pdfBase64 },
            },
            { type: 'text', text: prompt },
          ],
        }],
      },
    };
  });

  try {
    const batch = await client.messages.batches.create({ requests: batchRequests });

    await prisma.aiBatch.update({
      where: { id: aiBatch.id },
      data: {
        anthropic_batch_id: batch.id,
        status: 'processing',
      },
    });

    // Update settlements to processing
    await prisma.settlement.updateMany({
      where: { ai_batch_id: aiBatch.id },
      data: { extraction_status: 'processing' },
    });

    return {
      batch_id: aiBatch.id,
      anthropic_batch_id: batch.id,
      status: 'processing',
      total_requests: prepared.length,
      settlements: settlements.map(s => ({ id: s.settlementId, filename: s.filename, buyer_format: s.buyerFormat })),
    };
  } catch (err) {
    // Mark batch as failed
    const classified = classifyApiError(err);
    await prisma.aiBatch.update({
      where: { id: aiBatch.id },
      data: { status: 'failed', error_message: classified.message },
    });
    await prisma.settlement.updateMany({
      where: { ai_batch_id: aiBatch.id },
      data: { extraction_status: 'failed' },
    });
    throw Object.assign(new Error(classified.message), { code: classified.code });
  }
}

/**
 * Check batch status and process completed results.
 * Returns updated batch info.
 */
export async function checkBatchStatus(batchId) {
  const aiBatch = await prisma.aiBatch.findUnique({ where: { id: batchId } });
  if (!aiBatch) throw new Error('Batch not found');
  if (!aiBatch.anthropic_batch_id) throw new Error('Batch has no Anthropic ID');
  if (aiBatch.status === 'completed' || aiBatch.status === 'failed') {
    return aiBatch; // already done
  }

  const client = await getAnthropicClient();
  const batch = await client.messages.batches.retrieve(aiBatch.anthropic_batch_id);

  // Map Anthropic status to our status
  const statusMap = { in_progress: 'processing', ended: 'completed', canceling: 'processing', canceled: 'failed', expired: 'failed' };
  const newStatus = statusMap[batch.processing_status] || 'processing';

  if (newStatus === 'completed') {
    // Fetch and process results
    await processBatchResults(aiBatch);
  } else if (newStatus === 'failed') {
    await prisma.aiBatch.update({
      where: { id: batchId },
      data: { status: 'failed', error_message: `Batch ${batch.processing_status}` },
    });
    await prisma.settlement.updateMany({
      where: { ai_batch_id: batchId, extraction_status: 'processing' },
      data: { extraction_status: 'failed' },
    });
  } else {
    // Still processing — update counts
    const counts = batch.request_counts || {};
    await prisma.aiBatch.update({
      where: { id: batchId },
      data: {
        status: 'processing',
        completed_count: (counts.succeeded || 0) + (counts.errored || 0),
        failed_count: counts.errored || 0,
      },
    });
  }

  return prisma.aiBatch.findUnique({
    where: { id: batchId },
    include: {
      settlements: {
        select: { id: true, settlement_number: true, extraction_status: true, buyer_format: true, total_amount: true, notes: true },
        orderBy: { created_at: 'asc' },
      },
    },
  });
}

/**
 * Process completed batch results — extract data and populate settlements.
 */
async function processBatchResults(aiBatch) {
  const client = await getAnthropicClient();
  const results = await client.messages.batches.results(aiBatch.anthropic_batch_id);

  let completedCount = 0;
  let failedCount = 0;
  let totalInput = 0;
  let totalOutput = 0;

  // Iterate the results stream
  for await (const entry of results) {
    const customId = entry.custom_id;
    const settlement = await prisma.settlement.findFirst({
      where: { ai_batch_id: aiBatch.id, batch_custom_id: customId },
    });
    if (!settlement) continue;

    if (entry.result?.type === 'succeeded') {
      const response = entry.result.message;
      const usage = computeUsage(MODELS.extraction, response);
      totalInput += usage.input_tokens;
      totalOutput += usage.output_tokens;

      // Apply 50% batch discount
      const batchUsage = {
        ...usage,
        estimated_cost_usd: Math.round(usage.estimated_cost_usd * 0.5 * 10000) / 10000,
        batch_discount: '50%',
      };

      const text = response.content[0]?.text || '';
      try {
        const extraction = parseJsonResponse(text);

        // Look up counterparty and contract
        let counterpartyId = null;
        if (extraction.buyer) {
          const cp = await prisma.counterparty.findFirst({
            where: {
              farm_id: settlement.farm_id,
              OR: [
                { name: { contains: extraction.buyer, mode: 'insensitive' } },
                { short_code: { equals: extraction.buyer.toUpperCase().replace(/\s+/g, '').substring(0, 10) } },
              ],
            },
          });
          counterpartyId = cp?.id || null;
        }

        let contractId = null;
        if (extraction.contract_number) {
          const mc = await prisma.marketingContract.findFirst({
            where: { farm_id: settlement.farm_id, contract_number: extraction.contract_number },
          });
          contractId = mc?.id || null;
        }

        // Update settlement with extracted data
        await prisma.settlement.update({
          where: { id: settlement.id },
          data: {
            extraction_status: 'completed',
            settlement_number: extraction.settlement_number || settlement.settlement_number,
            settlement_date: extraction.settlement_date ? new Date(extraction.settlement_date) : null,
            total_amount: extraction.total_net_amount || extraction.total_gross_amount || null,
            settlement_gross: extraction.settlement_gross || extraction.total_gross_amount || null,
            deductions_summary: extraction.deductions_summary || null,
            counterparty_id: counterpartyId,
            marketing_contract_id: contractId,
            extraction_json: extraction,
            usage_json: batchUsage,
          },
        });

        // Post-process ticket numbers and create settlement lines
        let lines2 = postProcessTicketNumbers(extraction.lines || [], settlement.buyer_format).filter(l => !l._skip);

        // Cenovus: merge adjustment lines (same as in saveSettlement)
        if (settlement.buyer_format === 'cenovus' && lines2.length > 1) {
          const merged = [];
          const seen = new Set();
          for (const line of lines2) {
            const tn = String(line.ticket_number || '');
            if (seen.has(tn)) continue;
            const adjustments = lines2.filter(l =>
              l !== line && String(l.ticket_number || '') === tn &&
              (l.net_weight_mt || 0) < 1 && (l.price_per_mt || 0) <= 0.10
            );
            if (adjustments.length > 0) {
              const adjGross = adjustments.reduce((s, a) => s + (a.line_gross || 0), 0);
              merged.push({ ...line, line_gross: (line.line_gross || 0) + adjGross, line_net: line.line_net != null ? (line.line_net || 0) + adjGross : null });
              adjustments.forEach(a => seen.add(String(a.ticket_number || '')));
            } else {
              merged.push(line);
            }
            seen.add(tn);
          }
          lines2 = merged;
        }

        for (let i = 0; i < lines2.length; i++) {
          const line = lines2[i];
          await prisma.settlementLine.create({
            data: {
              settlement_id: settlement.id,
              line_number: line.line_number || i + 1,
              ticket_number_on_settlement: line.ticket_number || null,
              contract_number: line.contract_number || extraction.contract_number || null,
              delivery_date: line.delivery_date ? new Date(line.delivery_date) : null,
              commodity: line.commodity || extraction.commodity || null,
              grade: line.grade || null,
              gross_weight_mt: line.gross_weight_mt || null,
              net_weight_mt: line.net_weight_mt || null,
              price_per_mt: line.price_per_mt || null,
              price_per_bu: line.price_per_bu || null,
              deductions_json: line.deductions || null,
              line_gross: line.line_gross || null,
              line_net: line.line_net || null,
              match_status: 'unmatched',
            },
          });
        }

        completedCount++;
      } catch {
        await prisma.settlement.update({
          where: { id: settlement.id },
          data: { extraction_status: 'failed', notes: 'Failed to parse extraction result', usage_json: batchUsage },
        });
        failedCount++;
      }
    } else {
      // Failed entry
      const errMsg = entry.result?.error?.message || 'Unknown batch error';
      await prisma.settlement.update({
        where: { id: settlement.id },
        data: { extraction_status: 'failed', notes: errMsg },
      });
      failedCount++;
    }
  }

  // Calculate total cost with 50% batch discount
  const rates = PRICING[MODELS.extraction];
  const totalCost = ((totalInput * rates.input + totalOutput * rates.output) / 1_000_000) * 0.5;

  await prisma.aiBatch.update({
    where: { id: aiBatch.id },
    data: {
      status: failedCount === aiBatch.total_requests ? 'failed' : 'completed',
      completed_count: completedCount,
      failed_count: failedCount,
      total_input_tokens: totalInput,
      total_output_tokens: totalOutput,
      estimated_cost_usd: Math.round(totalCost * 10000) / 10000,
      completed_at: new Date(),
    },
  });
}
