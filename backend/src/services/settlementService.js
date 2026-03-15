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
            text: 'What grain company issued this settlement document? Reply with ONLY one word: "cargill", "bunge", "jgl", "richardson", "gsl", "ldc", or "unknown". Note: Louis Dreyfus Company = "ldc".',
          },
        ],
      }],
    });

    const usage = computeUsage(model, response);
    const answer = response.content[0]?.text?.trim().toLowerCase();
    const format = ['cargill', 'bunge', 'jgl', 'richardson', 'gsl', 'ldc'].includes(answer) ? answer : 'unknown';
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
 * Extract settlement data from a PDF buffer using Claude Vision.
 * Returns { extraction, buyerFormat, usage } where usage includes token counts and cost.
 */
export async function extractSettlementFromPdf(pdfBuffer, forceBuyerFormat = null) {
  const pdfBase64 = pdfBuffer.toString('base64');
  const usageBreakdown = [];

  // Detect or use forced format
  let buyerFormat = forceBuyerFormat;
  if (!buyerFormat) {
    const detection = await detectBuyerFormat(pdfBase64);
    buyerFormat = detection.format;
    if (detection.usage) usageBreakdown.push({ step: 'format_detection', ...detection.usage });
  }

  const prompt = EXTRACTION_PROMPTS[buyerFormat] || EXTRACTION_PROMPTS.unknown;
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
  const lines = postProcessTicketNumbers(extraction.lines || [], buyerFormat).filter(l => !l._skip);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    await prisma.settlementLine.create({
      data: {
        settlement_id: settlement.id,
        line_number: line.line_number || i + 1,
        ticket_number_on_settlement: line.ticket_number || null,
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
        const lines = postProcessTicketNumbers(extraction.lines || [], settlement.buyer_format).filter(l => !l._skip);
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          await prisma.settlementLine.create({
            data: {
              settlement_id: settlement.id,
              line_number: line.line_number || i + 1,
              ticket_number_on_settlement: line.ticket_number || null,
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
