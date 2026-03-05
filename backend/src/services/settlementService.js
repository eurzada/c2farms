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
  "contract_number": "string",
  "commodity": "string",
  "total_gross_amount": number,
  "total_net_amount": number,
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string (Cargill Unit#)",
      "delivery_date": "YYYY-MM-DD",
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

Look for Settlement Details tables with per-ticket rows. Cargill uses "Unit#" for their ticket numbers. Extract ALL ticket rows even across multiple pages. Return ONLY valid JSON, no extra text.`,

  bunge: `You are extracting data from a Bunge grain settlement PDF. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string",
  "settlement_date": "YYYY-MM-DD",
  "buyer": "Bunge",
  "contract_number": "string",
  "commodity": "string",
  "total_gross_amount": number,
  "total_net_amount": number,
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string",
      "delivery_date": "YYYY-MM-DD",
      "vehicle_id": "string or null",
      "gross_weight_mt": number,
      "net_weight_mt": number,
      "grade": "string or null",
      "moisture_pct": number or null,
      "dockage_pct": number or null,
      "price_per_mt": number or null,
      "line_gross": number or null,
      "line_net": number or null,
      "deductions": [{"name": "string", "amount": number}]
    }
  ]
}

Bunge settlements typically have one ticket per page. Look for Ticket Net Weight KG (convert to MT by dividing by 1000), Gross Qty MT, Net Qty MT. Return ONLY valid JSON, no extra text.`,

  jgl: `You are extracting data from a JGL Commodities grain settlement document. This may be a photographed/scanned document that could be rotated. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string",
  "settlement_date": "YYYY-MM-DD",
  "buyer": "JGL Commodities",
  "contract_number": "string",
  "commodity": "string",
  "total_gross_amount": number,
  "total_net_amount": number,
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string",
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

JGL documents show: ID, Contract#, Commodity, Settlement No, per-ticket rows with Ticket No, Vehicle Id, Date, Origin/CGC, MT Applied, Grade, DO. Also look for deduction summaries (Checkoff Levy, Drying, Quality discounts, Freight). Return ONLY valid JSON, no extra text.`,

  unknown: `You are extracting data from a grain settlement PDF. The buyer format is unknown. Extract ALL of the following into structured JSON:

{
  "settlement_number": "string",
  "settlement_date": "YYYY-MM-DD",
  "buyer": "string",
  "contract_number": "string or null",
  "commodity": "string",
  "total_gross_amount": number or null,
  "total_net_amount": number or null,
  "currency": "CAD",
  "lines": [
    {
      "line_number": 1,
      "ticket_number": "string or null",
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

Extract as much data as possible. Look for settlement/purchase number, dates, per-ticket or per-load detail rows, weights (convert kg to MT if needed), pricing, deductions. Return ONLY valid JSON, no extra text.`,
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
            text: 'What grain company issued this settlement document? Reply with ONLY one word: "cargill", "bunge", "jgl", or "unknown".',
          },
        ],
      }],
    });

    const usage = computeUsage(model, response);
    const answer = response.content[0]?.text?.trim().toLowerCase();
    const format = ['cargill', 'bunge', 'jgl'].includes(answer) ? answer : 'unknown';
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
      max_tokens: 4096,
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
      currency: extraction.currency || 'CAD',
      status: 'pending',
      buyer_format: buyerFormat,
      source_pdf_url: pdfUrl,
      extraction_json: extraction,
      usage_json: usage || null,
    },
  });

  // Create settlement lines
  const lines = extraction.lines || [];
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
        max_tokens: 4096,
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
            counterparty_id: counterpartyId,
            marketing_contract_id: contractId,
            extraction_json: extraction,
            usage_json: batchUsage,
          },
        });

        // Create settlement lines
        const lines = extraction.lines || [];
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
