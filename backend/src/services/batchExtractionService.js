/**
 * Batch contract extraction using Anthropic Message Batches API (50% discount).
 *
 * Flow:
 *   1. Upload multiple PDFs → build batch requests
 *   2. Submit to Anthropic Batches API
 *   3. Poll for completion
 *   4. Retrieve results, parse extractions
 *   5. User confirms → save contracts
 */

import prisma from '../config/database.js';
import { MODELS, PRICING, classifyApiError, getAnthropicClient, parseJsonResponse } from './aiClient.js';
import { buToMtFactor } from './marketingService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('batch-extraction');

// In-memory store for batch metadata (file names, farm context)
// Key: anthropic batch ID → { farmId, files: [{ custom_id, filename }], created_at }
const batchMeta = new Map();

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
- If the contract states a total value (e.g. "Contract Value: $500,000"), extract it as total_contract_value — this can be used to derive $/mt if no unit price is stated
- For basis contracts: extract basis_level and futures_reference separately from the flat price
- For HTA (Hedge-to-Arrive): extract futures_price and note the futures month
- Delivery period may be free text like "September 1 - October 31, 2026" — parse into start/end dates AND keep the original text
- Quantity may be in MT, tonnes, or bushels — convert to MT if possible (canola: 1 MT ≈ 44.09 bu, wheat/durum: 1 MT ≈ 36.74 bu)
- Look for the contract number prominently displayed (may be called Contract #, Agreement #, Confirmation #, Transaction #)
- The document may be scanned, photographed, or rotated — read carefully

Return ONLY valid JSON, no extra text.`;

/**
 * Create a batch of extraction requests from multiple PDF buffers.
 * @param {string} farmId
 * @param {{ buffer: Buffer, filename: string }[]} files
 * @returns {{ batchId: string, fileCount: number }}
 */
export async function createExtractionBatch(farmId, files) {
  const model = MODELS.extraction;
  const client = await getAnthropicClient();

  const requests = files.map((file, idx) => {
    const customId = `contract-${idx}-${file.filename.replace(/[^a-zA-Z0-9_-]/g, '_')}`.substring(0, 64);
    const base64 = file.buffer.toString('base64');
    const isImage = /\.(jpg|jpeg|png)$/i.test(file.filename);

    const content = isImage
      ? [
          { type: 'image', source: { type: 'base64', media_type: `image/${file.filename.match(/\.(jpg|jpeg|png)$/i)[1] === 'jpg' ? 'jpeg' : file.filename.match(/\.(jpg|jpeg|png)$/i)[1]}`, data: base64 } },
          { type: 'text', text: CONTRACT_EXTRACTION_PROMPT },
        ]
      : [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } },
          { type: 'text', text: CONTRACT_EXTRACTION_PROMPT },
        ];

    return {
      custom_id: customId,
      params: {
        model,
        max_tokens: 2048,
        messages: [{ role: 'user', content }],
      },
    };
  });

  let batch;
  try {
    batch = await client.messages.batches.create({ requests });
  } catch (err) {
    const classified = classifyApiError(err);
    throw Object.assign(new Error(classified.message), { code: classified.code });
  }

  // Store metadata for later retrieval
  batchMeta.set(batch.id, {
    farmId,
    model,
    files: files.map((f, idx) => ({
      custom_id: requests[idx].custom_id,
      filename: f.filename,
    })),
    created_at: new Date().toISOString(),
  });

  log.info(`Batch ${batch.id} created with ${files.length} files for farm ${farmId}`);

  return {
    batchId: batch.id,
    fileCount: files.length,
    status: batch.processing_status,
  };
}

/**
 * Poll batch status.
 * @param {string} batchId
 * @returns {{ status, counts, results? }}
 */
export async function getBatchStatus(batchId) {
  const client = await getAnthropicClient();
  const meta = batchMeta.get(batchId);

  let batch;
  try {
    batch = await client.messages.batches.retrieve(batchId);
  } catch (err) {
    const classified = classifyApiError(err);
    throw Object.assign(new Error(classified.message), { code: classified.code });
  }

  const response = {
    batchId: batch.id,
    status: batch.processing_status,
    counts: batch.request_counts,
    files: meta?.files || [],
  };

  // If ended, retrieve and parse results
  if (batch.processing_status === 'ended') {
    response.results = await retrieveBatchResults(client, batch.id, meta);
  }

  return response;
}

/**
 * Enrich extraction with computed $/bu ↔ $/mt conversions.
 * Mutates the extraction object in place.
 */
async function enrichExtractionPrices(extraction, farmId) {
  if (!extraction?.commodity || !farmId) return;
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
  const nameLower = extraction.commodity.toLowerCase();
  const aliasMatch = Object.entries(COMMODITY_ALIASES).find(([key]) => nameLower.includes(key));
  const searchTerms = [extraction.commodity, ...(aliasMatch ? [aliasMatch[1]] : [])];
  let commodity = null;
  for (const term of searchTerms) {
    commodity = await prisma.commodity.findFirst({
      where: { farm_id: farmId, name: { contains: term, mode: 'insensitive' } },
    });
    if (commodity) break;
  }
  if (!commodity) return;

  const factor = buToMtFactor(commodity.lbs_per_bu);
  const qtyMt = extraction.quantity_mt || 0;

  if (!extraction.price_per_bu && !extraction.price_per_mt && extraction.total_contract_value && qtyMt > 0) {
    extraction.price_per_mt = Math.round((extraction.total_contract_value / qtyMt) * 100) / 100;
  }
  if (extraction.price_per_bu && !extraction.price_per_mt) {
    extraction.price_per_mt = Math.round(extraction.price_per_bu * factor * 100) / 100;
  } else if (extraction.price_per_mt && !extraction.price_per_bu) {
    extraction.price_per_bu = Math.round((extraction.price_per_mt / factor) * 100) / 100;
  }
}

/**
 * Retrieve and parse batch results.
 */
async function retrieveBatchResults(client, batchId, meta) {
  const model = meta?.model || MODELS.extraction;
  const rates = PRICING[model] || PRICING[MODELS.extraction];
  const fileMap = new Map((meta?.files || []).map(f => [f.custom_id, f.filename]));

  const results = [];
  let totalInputTokens = 0;
  let totalOutputTokens = 0;

  for await (const result of client.messages.batches.results(batchId)) {
    const customId = result.custom_id;
    const filename = fileMap.get(customId) || customId;

    if (result.result.type === 'succeeded') {
      const message = result.result.message;
      const inputTokens = message.usage?.input_tokens || 0;
      const outputTokens = message.usage?.output_tokens || 0;
      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;

      const text = message.content[0]?.text || '';
      try {
        const extraction = parseJsonResponse(text);
        // Enrich with $/bu ↔ $/mt conversions
        try { await enrichExtractionPrices(extraction, meta?.farmId); } catch { /* non-critical */ }
        results.push({
          custom_id: customId,
          filename,
          status: 'success',
          extraction,
          tokens: { input: inputTokens, output: outputTokens },
        });
      } catch {
        results.push({
          custom_id: customId,
          filename,
          status: 'parse_error',
          error: 'Failed to parse extraction JSON',
          raw: text.substring(0, 300),
        });
      }
    } else if (result.result.type === 'errored') {
      results.push({
        custom_id: customId,
        filename,
        status: 'error',
        error: result.result.error?.message || 'Unknown error',
      });
    } else {
      results.push({
        custom_id: customId,
        filename,
        status: result.result.type, // expired, canceled
        error: `Request ${result.result.type}`,
      });
    }
  }

  // Compute total usage at batch discount (50%)
  const fullCost = (totalInputTokens * rates.input + totalOutputTokens * rates.output) / 1_000_000;
  const batchCost = fullCost * 0.5;

  return {
    items: results,
    usage: {
      model,
      total_input_tokens: totalInputTokens,
      total_output_tokens: totalOutputTokens,
      total_tokens: totalInputTokens + totalOutputTokens,
      full_price_usd: Math.round(fullCost * 10000) / 10000,
      batch_price_usd: Math.round(batchCost * 10000) / 10000,
      savings_usd: Math.round((fullCost - batchCost) * 10000) / 10000,
    },
  };
}

/**
 * Get stored batch metadata.
 */
export function getBatchMeta(batchId) {
  return batchMeta.get(batchId) || null;
}

/**
 * Clean up batch metadata after confirmation.
 */
export function clearBatchMeta(batchId) {
  batchMeta.delete(batchId);
}
