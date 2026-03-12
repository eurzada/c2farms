import prisma from '../config/database.js';
import { MODELS, computeUsage, classifyApiError, getAnthropicClient, parseJsonResponse } from './aiClient.js';
import { buToMtFactor, getNextCounterpartyCode } from './marketingService.js';

/**
 * Contract PDF extraction service.
 *
 * Uploads a buyer contract PDF → Claude extracts terms → creates/updates MarketingContract.
 */

const CONTRACT_EXTRACTION_PROMPT = `You are extracting data from a grain purchase contract PDF. This is a formal contract between a grain buyer and a farm (C2 Farms / Prairie Fields Farm in Saskatchewan, Canada).

Extract ALL of the following into structured JSON:

{
  "buyer": "string (company name: e.g. Cargill, Bunge, JGL Commodities, G3, Richardson, AGT Foods, LDC, Ceres Global)",
  "contract_number": "string",
  "contract_date": "YYYY-MM-DD or null",
  "commodity": "string — the BASE crop name only. Must be one of: Canola, Spring Wheat, Durum, Barley, Lentils, Yellow Peas, Chickpeas, Canary Seed, Oats. Do NOT include grade or class in this field (e.g. '2 CW Soft White Spring Wheat' → commodity is 'Spring Wheat', '1 CWAD Durum' → commodity is 'Durum', 'No 1 Canada Canola' → commodity is 'Canola')",
  "grade": "string or null — the grade/class designation extracted from the commodity description (e.g. '2 CW', '1 CWAD', '1 CWRS', '#1', '#2', '2CE', '1CWAD/1HAD'). This is the quality classification, separate from the crop name.",
  "quantity_mt": number,
  "quantity_bu": number or null,
  "price_per_mt": number or null,
  "price_per_bu": number or null,
  "pricing_type": "flat or basis or hta or min_price or deferred",
  "basis_level": number or null,
  "futures_reference": "string or null (e.g. ICE RS May26, MGEX HRS Jul26)",
  "futures_price": number or null,
  "currency": "CAD",
  "delivery_start": "YYYY-MM-DD or null",
  "delivery_end": "YYYY-MM-DD or null",
  "delivery_period_text": "string or null (original text of delivery period)",
  "elevator_site": "string or null (delivery location/elevator)",
  "crop_year": "string or null (e.g. 2025/26, 2025)",
  "special_terms": "string or null (any notable terms: specialty premium, rail, FOB, delivered, etc.)",
  "total_contract_value": number or null,
  "tolerance_pct": number or null,
  "notes": "string or null (any other relevant details)"
}

Important:
- Prices may be in $/bu or $/MT — extract whichever is stated, or both if available
- For basis contracts: extract basis_level and futures_reference separately from the flat price
- For HTA (Hedge-to-Arrive): extract futures_price and note the futures month
- Delivery period may be free text like "September 1 - October 31, 2026" — parse into start/end dates AND keep the original text
- Quantity may be in MT, tonnes, or bushels — convert to MT if possible (canola: 1 MT ≈ 44.09 bu, wheat/durum: 1 MT ≈ 36.74 bu)
- If the contract states a total value (e.g. "Contract Value: $500,000"), extract it as total_contract_value — this can be used to derive $/mt if no unit price is stated
- Look for the contract number prominently displayed (may be called Contract #, Agreement #, Confirmation #, Transaction #)
- The document may be scanned, photographed, or rotated — read carefully

Return ONLY valid JSON, no extra text.`;

/**
 * Classify whether a document is a contract or settlement using a cheap Haiku call.
 * Returns { document_type: 'contract' | 'settlement' | 'unknown', confidence: string }.
 */
export async function classifyDocumentType(pdfBuffer) {
  const pdfBase64 = pdfBuffer.toString('base64');
  const model = MODELS.detection;
  const client = await getAnthropicClient();

  const response = await client.messages.create({
    model,
    max_tokens: 100,
    messages: [{
      role: 'user',
      content: [
        {
          type: 'document',
          source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
        },
        {
          type: 'text',
          text: `Classify this grain industry document. Is it a PURCHASE CONTRACT (agreement to buy/sell grain at a price, with delivery terms) or a SETTLEMENT STATEMENT (a payment/accounting document listing delivered tickets, weights, deductions, and net payment amounts)?

Reply with ONLY valid JSON: {"document_type": "contract" or "settlement" or "unknown", "confidence": "high" or "medium" or "low", "reason": "brief explanation"}`,
        },
      ],
    }],
  });

  const usage = computeUsage(model, response);
  const text = response.content[0]?.text || '';
  try {
    const result = parseJsonResponse(text);
    return { ...result, usage };
  } catch {
    return { document_type: 'unknown', confidence: 'low', reason: 'Could not classify', usage };
  }
}

/**
 * Extract contract terms from a PDF buffer using Claude Vision.
 * Returns { extraction, usage, classification? }.
 */
export async function extractContractFromPdf(pdfBuffer) {
  const pdfBase64 = pdfBuffer.toString('base64');
  const model = MODELS.extraction;

  let response;
  try {
    const client = await getAnthropicClient();
    response = await client.messages.create({
      model,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: CONTRACT_EXTRACTION_PROMPT },
        ],
      }],
    });
  } catch (err) {
    const classified = classifyApiError(err);
    throw Object.assign(new Error(classified.message), { code: classified.code });
  }

  const usage = computeUsage(model, response);

  if (response.stop_reason === 'max_tokens') {
    throw Object.assign(
      new Error('Extraction was cut short — document may be too complex.'),
      { code: 'TRUNCATED', usage }
    );
  }

  const text = response.content[0]?.text || '';
  let extraction;
  try {
    extraction = parseJsonResponse(text);
  } catch {
    throw Object.assign(
      new Error('Failed to parse contract extraction result.'),
      { code: 'PARSE_ERROR', usage, raw_response: text.substring(0, 500) }
    );
  }

  return { extraction, usage };
}

/**
 * Save extracted contract to the database as a MarketingContract.
 * Finds or creates the counterparty and matches the commodity.
 * Returns the created/updated MarketingContract.
 */
export async function saveExtractedContract(farmId, extraction, _usage = null) {
  // Find or create counterparty
  const buyerName = extraction.buyer;
  if (!buyerName) throw new Error('Could not identify the buyer from this document.');

  let counterparty = await prisma.counterparty.findFirst({
    where: {
      farm_id: farmId,
      OR: [
        { name: { contains: buyerName, mode: 'insensitive' } },
        { name: { equals: buyerName, mode: 'insensitive' } },
      ],
    },
  });

  if (!counterparty) {
    const shortCode = await getNextCounterpartyCode(farmId);
    counterparty = await prisma.counterparty.create({
      data: {
        farm_id: farmId,
        name: buyerName,
        short_code: shortCode,
        type: 'buyer',
      },
    });
  }

  // Match commodity — try progressively broader matching
  const commodityName = extraction.commodity;
  if (!commodityName) throw new Error('Could not identify the commodity from this document.');

  // Common aliases: formal contract names → database commodity names
  const COMMODITY_ALIASES = {
    'cwrs': 'Spring Wheat', 'hard red spring': 'Spring Wheat', 'soft white spring': 'Spring Wheat',
    'spring wheat': 'Spring Wheat', 'hrs': 'Spring Wheat', 'sws': 'Spring Wheat',
    'cwad': 'Durum', 'durum wheat': 'Durum', 'amber durum': 'Durum',
    'canola': 'Canola', 'nexera': 'Canola',
    'yellow peas': 'Yellow Peas', 'yellow pea': 'Yellow Peas',
    'lentils': 'Lentils', 'small green lentils': 'Lentils SG', 'small red lentils': 'Lentils SR',
    'green lentils': 'Lentils SG', 'red lentils': 'Lentils SR',
    'chickpeas': 'Chickpeas', 'chickpea': 'Chickpeas', 'desi chickpeas': 'Chickpeas',
    'canary seed': 'Canary Seed', 'barley': 'Barley', 'feed barley': 'Barley', 'malt barley': 'Barley',
  };

  // Build search terms: original name, alias lookup, and key words
  const nameLower = commodityName.toLowerCase();
  const aliasMatch = Object.entries(COMMODITY_ALIASES).find(([key]) => nameLower.includes(key));
  const searchTerms = [
    commodityName,
    ...(aliasMatch ? [aliasMatch[1]] : []),
    ...commodityName.split(/[\s,]+/).filter(w => w.length > 3),
  ];

  let commodity = null;
  for (const term of searchTerms) {
    commodity = await prisma.commodity.findFirst({
      where: { farm_id: farmId, name: { contains: term, mode: 'insensitive' } },
    });
    if (commodity) break;
  }
  if (!commodity) throw new Error(`Commodity "${commodityName}" not found. Add it in Inventory first.`);

  const contractNumber = extraction.contract_number;
  if (!contractNumber) throw new Error('Could not find a contract number in this document.');

  const quantityMt = extraction.quantity_mt || 0;

  // ─── Price normalization: ensure both $/bu and $/mt are populated ───
  const factor = buToMtFactor(commodity.lbs_per_bu);
  let priceBu = extraction.price_per_bu || null;
  let priceMt = extraction.price_per_mt || null;

  // Fallback: derive $/mt from total contract value ÷ tonnage
  if (!priceBu && !priceMt && extraction.total_contract_value && quantityMt > 0) {
    priceMt = Math.round((extraction.total_contract_value / quantityMt) * 100) / 100;
  }

  // Cross-convert whichever is missing
  if (priceBu && !priceMt) {
    priceMt = Math.round(priceBu * factor * 100) / 100;
  } else if (priceMt && !priceBu) {
    priceBu = Math.round((priceMt / factor) * 100) / 100;
  }

  // Check if contract already exists (upsert)
  const existing = await prisma.marketingContract.findFirst({
    where: { farm_id: farmId, contract_number: contractNumber },
  });

  const contractValue = priceMt && quantityMt ? priceMt * quantityMt : (extraction.total_contract_value || null);

  const contractData = {
    farm_id: farmId,
    contract_number: contractNumber,
    crop_year: extraction.crop_year || '',
    commodity_id: commodity.id,
    counterparty_id: counterparty.id,
    grade: extraction.grade || null,
    contracted_mt: quantityMt,
    remaining_mt: quantityMt,
    pricing_type: extraction.pricing_type
      || (extraction.basis_level && !priceBu && !priceMt ? 'basis'
        : extraction.futures_price && !priceBu && !priceMt ? 'hta'
        : 'flat'),
    pricing_status: priceMt || priceBu ? 'priced'
      : extraction.basis_level ? 'partially_priced'
      : 'unpriced',
    price_per_bu: priceBu,
    price_per_mt: priceMt,
    basis_level: extraction.basis_level || null,
    futures_reference: extraction.futures_reference || null,
    futures_price: extraction.futures_price || null,
    currency: extraction.currency || 'CAD',
    delivery_start: extraction.delivery_start ? new Date(extraction.delivery_start) : null,
    delivery_end: extraction.delivery_end ? new Date(extraction.delivery_end) : null,
    elevator_site: extraction.elevator_site || null,
    tolerance_pct: extraction.tolerance_pct || null,
    contract_value: contractValue,
    notes: [extraction.special_terms, extraction.notes, extraction.delivery_period_text].filter(Boolean).join(' | ') || null,
    status: 'executed',
  };

  let contract;
  if (existing) {
    contract = await prisma.marketingContract.update({
      where: { id: existing.id },
      data: {
        ...contractData,
        // Preserve delivered amounts if already tracking
        delivered_mt: existing.delivered_mt,
        remaining_mt: quantityMt - existing.delivered_mt,
        status: existing.status,
      },
    });
  } else {
    contract = await prisma.marketingContract.create({ data: contractData });
  }

  return prisma.marketingContract.findUnique({
    where: { id: contract.id },
    include: { counterparty: true, commodity: true },
  });
}

