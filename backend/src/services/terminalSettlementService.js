import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { resolveInventoryFarm } from './resolveInventoryFarm.js';
import { getOrCreateLgxCounterparty } from './marketingService.js';
import { extractSettlementFromPdf } from './settlementService.js';
import PdfPrinter from 'pdfmake';
import { getFontPaths } from '../utils/fontPaths.js';

const logger = createLogger('terminal:settlements');

const standardIncludes = {
  counterparty: { select: { id: true, name: true, short_code: true } },
  contract: {
    select: { id: true, contract_number: true, direction: true, contracted_mt: true, delivered_mt: true },
  },
  lines: {
    include: {
      ticket: { select: { id: true, ticket_number: true, ticket_date: true, product: true, weight_kg: true } },
      commodity: { select: { id: true, name: true, code: true } },
    },
    orderBy: { line_number: 'asc' },
  },
};

/**
 * Create a terminal settlement with line items.
 */
export async function createSettlementWithLines(farmId, data) {
  try {
    const lines = (data.lines || []).map((line, idx) => {
      const lineAmount = (line.net_weight_mt != null && line.price_per_mt != null)
        ? line.net_weight_mt * line.price_per_mt
        : null;
      return {
        line_number: line.line_number ?? (idx + 1),
        ticket_id: line.ticket_id || null,
        source_farm_name: line.source_farm_name || null,
        commodity_id: line.commodity_id || null,
        grade: line.grade || null,
        gross_weight_mt: line.gross_weight_mt ?? null,
        tare_weight_mt: line.tare_weight_mt ?? null,
        net_weight_mt: line.net_weight_mt ?? null,
        price_per_mt: line.price_per_mt ?? null,
        line_amount: lineAmount,
      };
    });

    const grossAmount = lines.reduce((sum, l) => sum + (l.line_amount || 0), 0);

    const settlement = await prisma.terminalSettlement.create({
      data: {
        farm_id: farmId,
        type: data.type || 'transfer',
        settlement_number: data.settlement_number,
        counterparty_id: data.counterparty_id,
        contract_id: data.contract_id || null,
        marketing_contract_id: data.marketing_contract_id || null,
        settlement_date: new Date(data.settlement_date),
        gross_amount: grossAmount,
        net_amount: grossAmount,
        status: 'draft',
        notes: data.notes || null,
        lines: { create: lines },
      },
      include: standardIncludes,
    });

    logger.info('Created terminal settlement', { id: settlement.id, farmId, type: data.type });
    return settlement;
  } catch (err) {
    logger.error('Failed to create settlement', { farmId, error: err.message });
    throw err;
  }
}

/**
 * Apply grade-based pricing from linked contract's grade_prices_json to settlement lines.
 */
export async function applyGradePricing(settlementId) {
  const settlement = await prisma.terminalSettlement.findUnique({
    where: { id: settlementId },
    include: {
      lines: true,
      contract: { select: { grade_prices_json: true } },
    },
  });
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });

  const gradePrices = settlement.contract?.grade_prices_json;
  if (!gradePrices || !Array.isArray(gradePrices)) {
    throw Object.assign(new Error('No grade pricing schedule found on linked contract'), { status: 400 });
  }

  // Build a lookup: grade name → price_per_mt
  const priceMap = {};
  for (const gp of gradePrices) {
    if (gp.grade && gp.price_per_mt != null) {
      priceMap[gp.grade.toLowerCase()] = gp.price_per_mt;
    }
  }

  return prisma.$transaction(async (tx) => {
    for (const line of settlement.lines) {
      const gradeKey = (line.grade || '').toLowerCase();
      const price = priceMap[gradeKey];
      if (price != null && line.net_weight_mt != null) {
        const lineAmount = line.net_weight_mt * price;
        await tx.terminalSettlementLine.update({
          where: { id: line.id },
          data: { price_per_mt: price, line_amount: lineAmount },
        });
      }
    }

    // Recompute totals
    const updatedLines = await tx.terminalSettlementLine.findMany({
      where: { terminal_settlement_id: settlementId },
    });
    const grossAmount = updatedLines.reduce((sum, l) => sum + (l.line_amount || 0), 0);

    return tx.terminalSettlement.update({
      where: { id: settlementId },
      data: { gross_amount: grossAmount, net_amount: grossAmount },
      include: standardIncludes,
    });
  });
}

/**
 * Finalize a settlement — validates all lines have pricing.
 */
export async function finalizeSettlement(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: { lines: true },
  });
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (settlement.status !== 'draft') {
    throw Object.assign(new Error(`Cannot finalize settlement with status "${settlement.status}"`), { status: 400 });
  }

  const unpricedLines = settlement.lines.filter(l => l.price_per_mt == null);
  if (unpricedLines.length > 0) {
    throw Object.assign(
      new Error(`${unpricedLines.length} line(s) missing pricing — apply grade pricing first`),
      { status: 400 },
    );
  }

  // Update contract delivered_mt and remaining_mt
  const totalSettledMt = settlement.lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0);

  return prisma.$transaction(async (tx) => {
    if (settlement.contract_id && totalSettledMt > 0) {
      const contract = await tx.terminalContract.findUnique({
        where: { id: settlement.contract_id },
      });
      if (contract) {
        const newDelivered = (contract.delivered_mt || 0) + totalSettledMt;
        const rawRemaining = contract.contracted_mt - newDelivered;
        const newRemaining = rawRemaining < 0.5 ? 0 : rawRemaining; // tolerance for floating-point dust
        const newStatus = newRemaining <= 0 ? 'fulfilled' : 'in_delivery';
        await tx.terminalContract.update({
          where: { id: contract.id },
          data: {
            delivered_mt: newDelivered,
            remaining_mt: newRemaining,
            status: newStatus,
          },
        });
        logger.info('Updated contract delivery totals', {
          contractId: contract.id,
          delivered: newDelivered,
          remaining: newRemaining,
          status: newStatus,
        });
      }
    }

    return tx.terminalSettlement.update({
      where: { id: settlementId },
      data: { status: 'finalized' },
      include: standardIncludes,
    });
  });
}

/**
 * Push a finalized terminal settlement into the enterprise logistics pipeline
 * as a Settlement record. THE KEY FUNCTION.
 */
export async function pushToLogistics(farmId, settlementId, io) {
  // 1. Load and validate
  const terminalSettlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: {
      contract: {
        select: {
          contract_number: true,
          commodity: { select: { id: true, name: true, code: true } },
        },
      },
      lines: {
        include: {
          ticket: { select: { id: true, ticket_number: true, ticket_date: true } },
          commodity: { select: { id: true, name: true } },
        },
        orderBy: { line_number: 'asc' },
      },
    },
  });
  if (!terminalSettlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (terminalSettlement.status !== 'finalized') {
    throw Object.assign(new Error('Settlement must be finalized before pushing'), { status: 400 });
  }
  if (terminalSettlement.pushed_settlement_id) {
    throw Object.assign(new Error('Settlement has already been pushed'), { status: 400 });
  }

  // 2. Resolve enterprise farm
  const { farmId: enterpriseFarmId } = await resolveInventoryFarm(farmId);

  // 3. Find/create LGX counterparty
  const lgxCounterparty = await getOrCreateLgxCounterparty(enterpriseFarmId);

  // 4. Transaction: create Settlement + SettlementLines, update TerminalSettlement
  const result = await prisma.$transaction(async (tx) => {
    // 4a. Build settlement number: LGXS-{seq}-{contract#}
    const contractNum = terminalSettlement.contract?.contract_number;
    let settlementNum;
    if (contractNum) {
      // Count existing LGXS settlements for this contract to determine sequence
      const existingCount = await tx.settlement.count({
        where: {
          farm_id: enterpriseFarmId,
          settlement_number: { startsWith: `LGXS-` },
          extraction_json: { path: ['contract_number'], equals: contractNum },
        },
      });
      const seq = String(existingCount + 1).padStart(3, '0');
      settlementNum = `LGXS-${seq}-${contractNum}`;
    } else {
      settlementNum = `LGXS-${terminalSettlement.settlement_number}`;
    }

    // 4b. Create logistics Settlement
    const settlement = await tx.settlement.create({
      data: {
        farm_id: enterpriseFarmId,
        settlement_number: settlementNum,
        source: 'lgx_transfer',
        terminal_settlement_id: terminalSettlement.id,
        marketing_contract_id: terminalSettlement.marketing_contract_id || null,
        counterparty_id: lgxCounterparty.id,
        settlement_date: terminalSettlement.settlement_date,
        total_amount: terminalSettlement.net_amount,
        status: 'pending',
        buyer_format: 'lgx',
        extraction_status: 'completed',
        extraction_json: {
          contract_number: contractNum || null,
          commodity: terminalSettlement.contract?.commodity?.name || null,
        },
      },
    });

    // 4b. Match terminal ticket numbers → DeliveryTickets for auto-reconciliation
    const ticketNumbers = terminalSettlement.lines
      .filter(l => l.ticket?.ticket_number)
      .map(l => String(l.ticket.ticket_number));

    const deliveryTickets = ticketNumbers.length > 0
      ? await tx.deliveryTicket.findMany({
          where: { farm_id: enterpriseFarmId, ticket_number: { in: ticketNumbers } },
          select: { id: true, ticket_number: true },
        })
      : [];
    const dtMap = new Map(deliveryTickets.map(dt => [dt.ticket_number, dt.id]));

    // 4c. Create SettlementLine records — auto-matched where possible
    const lineData = terminalSettlement.lines.map(line => {
      const ticketNum = line.ticket?.ticket_number?.toString() || null;
      const deliveryTicketId = ticketNum ? dtMap.get(ticketNum) || null : null;
      return {
        settlement_id: settlement.id,
        line_number: line.line_number,
        ticket_number_on_settlement: ticketNum,
        delivery_ticket_id: deliveryTicketId,
        delivery_date: line.ticket?.ticket_date || null,
        commodity: line.commodity?.name || terminalSettlement.contract?.commodity?.name || null,
        grade: line.grade || null,
        gross_weight_mt: line.gross_weight_mt || null,
        net_weight_mt: line.net_weight_mt || null,
        price_per_mt: line.price_per_mt || null,
        line_gross: line.line_amount || null,
        line_net: line.line_amount || null,
        match_status: deliveryTicketId ? 'matched' : 'unmatched',
        match_confidence: deliveryTicketId ? 1.0 : null,
      };
    });

    if (lineData.length > 0) {
      await tx.settlementLine.createMany({ data: lineData });
    }

    const matchedCount = lineData.filter(l => l.delivery_ticket_id).length;
    logger.info('Auto-reconciled settlement lines', { matchedCount, totalLines: lineData.length });

    // 4c. Update linked MarketingContract (delivered_mt, status)
    let marketingContractId = terminalSettlement.marketing_contract_id || null;
    if (terminalSettlement.contract_id) {
      const linkedMc = await tx.marketingContract.findFirst({
        where: { linked_terminal_contract_id: terminalSettlement.contract_id },
      });
      if (linkedMc) {
        marketingContractId = linkedMc.id;
        const totalMt = lineData.reduce((s, l) => s + (l.net_weight_mt || 0), 0);
        const newDelivered = (linkedMc.delivered_mt || 0) + totalMt;
        const rawRemaining = linkedMc.contracted_mt - newDelivered;
        const newRemaining = rawRemaining < 0.5 ? 0 : rawRemaining; // tolerance for floating-point dust
        const newStatus = newRemaining <= 0 ? 'delivered' : 'in_delivery';
        await tx.marketingContract.update({
          where: { id: linkedMc.id },
          data: { delivered_mt: newDelivered, remaining_mt: newRemaining, status: newStatus },
        });
        logger.info('Updated linked MarketingContract', {
          id: linkedMc.id, contractNumber: linkedMc.contract_number,
          delivered: newDelivered, remaining: newRemaining, status: newStatus,
        });
      }
    }

    // 4d. Link settlement to MarketingContract if found
    if (marketingContractId) {
      await tx.settlement.update({
        where: { id: settlement.id },
        data: { marketing_contract_id: marketingContractId },
      });
    }

    // 4e. Mark terminal settlement as pushed
    await tx.terminalSettlement.update({
      where: { id: settlementId },
      data: {
        status: 'pushed',
        pushed_settlement_id: settlement.id,
        marketing_contract_id: marketingContractId,
      },
    });

    return settlement;
  });

  // 5. Broadcast event
  if (io) {
    io.to(enterpriseFarmId).emit('settlement:created', { id: result.id });
  }

  logger.info('Pushed terminal settlement to logistics', {
    terminalSettlementId: settlementId,
    settlementId: result.id,
    enterpriseFarmId,
  });

  return result;
}

/**
 * Get eligible tickets for a new settlement, filtered by type.
 */
export async function getEligibleTickets(farmId, type = 'transfer') {
  const isC2 = type === 'transfer';

  const tickets = await prisma.terminalTicket.findMany({
    where: {
      farm_id: farmId,
      direction: 'inbound',
      is_c2_farms: isC2,
      status: 'complete',
      terminal_settlement_lines: { none: {} },
    },
    select: {
      id: true,
      ticket_number: true,
      ticket_date: true,
      product: true,
      weight_kg: true,
      grower_name: true,
      protein_pct: true,
      moisture_pct: true,
      test_weight: true,
      dockage_pct: true,
    },
    orderBy: { ticket_number: 'asc' },
  });

  // For C2 transfers, look up matching DeliveryTickets to pull grade + date
  if (isC2 && tickets.length > 0) {
    const { farmId: enterpriseFarmId } = await resolveInventoryFarm(farmId);
    const ticketNumbers = tickets.map(t => String(t.ticket_number));
    const deliveryTickets = await prisma.deliveryTicket.findMany({
      where: {
        farm_id: enterpriseFarmId,
        ticket_number: { in: ticketNumbers },
      },
      select: {
        ticket_number: true,
        grade: true,
        delivery_date: true,
        commodity: { select: { id: true, name: true, code: true } },
      },
    });
    const dtMap = new Map(deliveryTickets.map(dt => [dt.ticket_number, dt]));

    return tickets.map(t => {
      const dt = dtMap.get(String(t.ticket_number));
      return {
        ...t,
        grade: dt?.grade || null,
        delivery_date: dt?.delivery_date || t.ticket_date,
        logistics_commodity: dt?.commodity || null,
      };
    });
  }

  return tickets;
}

/**
 * List settlements with pagination and optional filters.
 */
export async function getSettlements(farmId, { type, status, page = 1, limit = 50 } = {}) {
  try {
    const where = { farm_id: farmId };
    if (type) where.type = type;
    if (status) where.status = status;

    const skip = (page - 1) * limit;
    const [settlements, total] = await Promise.all([
      prisma.terminalSettlement.findMany({
        where,
        include: standardIncludes,
        orderBy: { settlement_date: 'desc' },
        skip,
        take: limit,
      }),
      prisma.terminalSettlement.count({ where }),
    ]);

    return {
      settlements,
      pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
    };
  } catch (err) {
    logger.error('Failed to list settlements', { farmId, error: err.message });
    throw err;
  }
}

/**
 * Get a single settlement with all related data.
 */
export async function getSettlement(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: standardIncludes,
  });
  if (!settlement) {
    throw Object.assign(new Error('Settlement not found'), { status: 404 });
  }
  return settlement;
}

/**
 * Update a draft settlement. If lines are provided, full replacement.
 */
export async function updateSettlement(farmId, settlementId, data) {
  const existing = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
  });
  if (!existing) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (existing.status !== 'draft') {
    throw Object.assign(new Error('Can only edit draft settlements'), { status: 400 });
  }

  return prisma.$transaction(async (tx) => {
    // Update allowed scalar fields
    const updateData = {};
    const allowed = [
      'settlement_number', 'counterparty_id', 'contract_id',
      'marketing_contract_id', 'settlement_date', 'notes',
    ];
    for (const key of allowed) {
      if (data[key] !== undefined) {
        if (key === 'settlement_date') {
          updateData[key] = data[key] ? new Date(data[key]) : null;
        } else {
          updateData[key] = data[key];
        }
      }
    }

    // If lines provided, delete and recreate
    if (Array.isArray(data.lines)) {
      await tx.terminalSettlementLine.deleteMany({
        where: { terminal_settlement_id: settlementId },
      });

      const newLines = data.lines.map((line, idx) => {
        const lineAmount = (line.net_weight_mt != null && line.price_per_mt != null)
          ? line.net_weight_mt * line.price_per_mt
          : null;
        return {
          terminal_settlement_id: settlementId,
          line_number: line.line_number ?? (idx + 1),
          ticket_id: line.ticket_id || null,
          source_farm_name: line.source_farm_name || null,
          commodity_id: line.commodity_id || null,
          grade: line.grade || null,
          gross_weight_mt: line.gross_weight_mt ?? null,
          tare_weight_mt: line.tare_weight_mt ?? null,
          net_weight_mt: line.net_weight_mt ?? null,
          price_per_mt: line.price_per_mt ?? null,
          line_amount: lineAmount,
        };
      });

      if (newLines.length > 0) {
        await tx.terminalSettlementLine.createMany({ data: newLines });
      }

      // Recompute totals
      const grossAmount = newLines.reduce((sum, l) => sum + (l.line_amount || 0), 0);
      updateData.gross_amount = grossAmount;
      updateData.net_amount = grossAmount;
    }

    return tx.terminalSettlement.update({
      where: { id: settlementId },
      data: updateData,
      include: standardIncludes,
    });
  });
}

/**
 * Update a single settlement line (grade, price). Recomputes line amount and settlement totals.
 */
export async function updateSettlementLine(farmId, settlementId, lineId, data) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
  });
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (settlement.status !== 'draft') {
    throw Object.assign(new Error('Can only edit draft settlements'), { status: 400 });
  }

  const line = await prisma.terminalSettlementLine.findFirst({
    where: { id: lineId, terminal_settlement_id: settlementId },
  });
  if (!line) throw Object.assign(new Error('Line not found'), { status: 404 });

  const grade = data.grade !== undefined ? data.grade : line.grade;
  const pricePmt = data.price_per_mt !== undefined ? parseFloat(data.price_per_mt) : line.price_per_mt;
  const netMt = line.net_weight_mt;
  const lineAmount = (netMt != null && pricePmt != null) ? netMt * pricePmt : null;

  await prisma.terminalSettlementLine.update({
    where: { id: lineId },
    data: { grade, price_per_mt: pricePmt, line_amount: lineAmount },
  });

  // Recompute settlement totals
  const allLines = await prisma.terminalSettlementLine.findMany({
    where: { terminal_settlement_id: settlementId },
  });
  const grossAmount = allLines.reduce((sum, l) => sum + (l.line_amount || 0), 0);
  await prisma.terminalSettlement.update({
    where: { id: settlementId },
    data: { gross_amount: grossAmount, net_amount: grossAmount },
  });

  return getSettlement(farmId, settlementId);
}

/**
 * Settlement summary: counts and totals by type and status.
 */
export async function getSettlementSummary(farmId) {
  const settlements = await prisma.terminalSettlement.findMany({
    where: { farm_id: farmId },
    select: { type: true, status: true, net_amount: true },
  });

  const byType = {};
  for (const s of settlements) {
    if (!byType[s.type]) byType[s.type] = { count: 0, total_amount: 0, by_status: {} };
    byType[s.type].count++;
    byType[s.type].total_amount += s.net_amount || 0;
    if (!byType[s.type].by_status[s.status]) byType[s.type].by_status[s.status] = { count: 0, total: 0 };
    byType[s.type].by_status[s.status].count++;
    byType[s.type].by_status[s.status].total += s.net_amount || 0;
  }

  return {
    total_count: settlements.length,
    total_amount: settlements.reduce((s, x) => s + (x.net_amount || 0), 0),
    by_type: byType,
  };
}

// ── Buyer Settlement Functions ──────────────────────────────────────────────

/**
 * Upload and extract a buyer settlement PDF (e.g. JGL settlement).
 * Creates a TerminalSettlement with type='buyer_settlement' in draft status.
 */
export async function uploadBuyerSettlementPdf(farmId, pdfBuffer, filename) {
  logger.info('Uploading buyer settlement PDF', { farmId, filename });

  // 1. Extract via Claude Vision (reuses existing extraction prompts)
  const { extraction, buyerFormat, usage } = await extractSettlementFromPdf(pdfBuffer);

  // 2. Auto-find counterparty by buyer name
  const buyerName = extraction.buyer || '';
  let counterparty = await prisma.counterparty.findFirst({
    where: {
      farm_id: farmId,
      name: { contains: buyerName.split(' ')[0], mode: 'insensitive' },
      is_active: true,
    },
  });
  if (!counterparty) {
    // Fallback: create one
    counterparty = await prisma.counterparty.create({
      data: {
        farm_id: farmId,
        name: buyerName || 'Unknown Buyer',
        short_code: (buyerName || 'UNK').substring(0, 4).toUpperCase(),
        type: 'buyer',
      },
    });
  }

  // 3. Auto-link to TerminalContract by contract_number (direction='sale')
  let contractId = null;
  if (extraction.contract_number) {
    const contract = await prisma.terminalContract.findFirst({
      where: {
        farm_id: farmId,
        contract_number: extraction.contract_number,
        direction: 'sale',
      },
    });
    if (contract) contractId = contract.id;
  }

  // 4. Build settlement number
  const settlementNumber = extraction.settlement_number
    ? `BUYER-${extraction.settlement_number}`
    : `BUYER-${Date.now()}`;

  // 5. Build deductions summary
  const deductionsSummary = extraction.deductions_summary || [];
  const totalDeductions = deductionsSummary.reduce((s, d) => s + (d.amount || 0), 0);
  const grossAmount = extraction.total_gross_amount || extraction.settlement_gross || 0;
  const netAmount = extraction.total_net_amount || (grossAmount + totalDeductions) || 0;

  // 6. Build lines from extraction
  const lines = (extraction.lines || []).map((line, idx) => ({
    line_number: line.line_number ?? (idx + 1),
    ticket_id: null,
    source_farm_name: line.origin || null,
    commodity_id: null,
    grade: line.grade || null,
    gross_weight_mt: line.gross_weight_mt ?? null,
    tare_weight_mt: null,
    net_weight_mt: line.net_weight_mt ?? null,
    price_per_mt: line.price_per_mt ?? null,
    line_amount: line.line_gross ?? (line.net_weight_mt && line.price_per_mt ? line.net_weight_mt * line.price_per_mt : null),
    match_status: 'unmatched',
    match_confidence: null,
    // Stash ticket_number in source_farm_name temporarily for reconciliation
    source_farm_name: line.ticket_number ? String(line.ticket_number) : null,
  }));

  // 7. Find commodity by extraction
  let commodityId = null;
  if (extraction.commodity) {
    const commodity = await prisma.commodity.findFirst({
      where: {
        farm_id: farmId,
        name: { contains: extraction.commodity.split(' ')[0], mode: 'insensitive' },
      },
    });
    if (commodity) commodityId = commodity.id;
  }
  if (commodityId) {
    for (const line of lines) {
      line.commodity_id = commodityId;
    }
  }

  // 8. Create settlement
  const settlement = await prisma.terminalSettlement.create({
    data: {
      farm_id: farmId,
      type: 'buyer_settlement',
      settlement_number: settlementNumber,
      counterparty_id: counterparty.id,
      contract_id: contractId,
      settlement_date: extraction.settlement_date ? new Date(extraction.settlement_date) : new Date(),
      gross_amount: grossAmount,
      net_amount: netAmount,
      settlement_gross: grossAmount,
      deductions_summary: deductionsSummary,
      extraction_json: extraction,
      extraction_status: 'completed',
      buyer_format: buyerFormat,
      status: 'draft',
      lines: { create: lines },
    },
    include: standardIncludes,
  });

  logger.info('Created buyer settlement from PDF', {
    id: settlement.id,
    buyer: buyerName,
    contract: extraction.contract_number,
    lines: lines.length,
    gross: grossAmount,
    net: netAmount,
  });

  return { settlement, extraction, usage };
}

/**
 * Reconcile buyer settlement lines against outbound TerminalTickets.
 * Matches by ticket_number from the extraction (stored in source_farm_name on lines).
 */
export async function reconcileBuyerSettlement(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId, type: 'buyer_settlement' },
    include: { lines: { orderBy: { line_number: 'asc' } } },
  });
  if (!settlement) throw Object.assign(new Error('Buyer settlement not found'), { status: 404 });

  // Load outbound TerminalTickets
  const outboundTickets = await prisma.terminalTicket.findMany({
    where: { farm_id: farmId, direction: 'outbound', status: 'complete' },
    select: { id: true, ticket_number: true, ticket_date: true, weight_kg: true, product: true },
  });
  const ticketMap = new Map();
  for (const t of outboundTickets) {
    ticketMap.set(String(t.ticket_number), t);
  }

  let matched = 0;
  let unmatched = 0;

  await prisma.$transaction(async (tx) => {
    for (const line of settlement.lines) {
      // The ticket number from the PDF is stored in source_farm_name
      const extractedTicketNum = line.source_farm_name;
      if (!extractedTicketNum) {
        unmatched++;
        continue;
      }

      const ticket = ticketMap.get(extractedTicketNum);
      if (ticket) {
        await tx.terminalSettlementLine.update({
          where: { id: line.id },
          data: {
            ticket_id: ticket.id,
            match_status: 'matched',
            match_confidence: 1.0,
          },
        });
        matched++;
      } else {
        // Fallback: try weight/date scoring
        const lineMt = line.net_weight_mt || 0;
        let bestMatch = null;
        let bestScore = 0;

        for (const t of outboundTickets) {
          const ticketMt = (t.weight_kg || 0) / 1000;
          if (ticketMt <= 0) continue;
          const weightDiff = Math.abs(ticketMt - lineMt) / ticketMt;
          if (weightDiff < 0.02) { // within 2%
            const score = 1 - weightDiff;
            if (score > bestScore) {
              bestScore = score;
              bestMatch = t;
            }
          }
        }

        if (bestMatch && bestScore > 0.95) {
          await tx.terminalSettlementLine.update({
            where: { id: line.id },
            data: {
              ticket_id: bestMatch.id,
              match_status: 'matched',
              match_confidence: bestScore,
            },
          });
          matched++;
        } else {
          await tx.terminalSettlementLine.update({
            where: { id: line.id },
            data: { match_status: 'unmatched', match_confidence: null },
          });
          unmatched++;
        }
      }
    }
  });

  logger.info('Reconciled buyer settlement', { settlementId, matched, unmatched });

  return {
    total_lines: settlement.lines.length,
    matched,
    unmatched,
    match_rate: settlement.lines.length > 0 ? Math.round((matched / settlement.lines.length) * 100) : 0,
  };
}

/**
 * Compute realization: buyer_net - transfer_net = margin.
 * Finds transfer settlements on the same contract.
 */
export async function computeRealization(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId, type: 'buyer_settlement' },
    include: {
      contract: { select: { id: true, contract_number: true } },
      lines: true,
    },
  });
  if (!settlement) throw Object.assign(new Error('Buyer settlement not found'), { status: 404 });

  if (!settlement.contract_id) {
    throw Object.assign(new Error('No contract linked to this buyer settlement'), { status: 400 });
  }

  // Find all transfer settlements on the same contract
  const transfers = await prisma.terminalSettlement.findMany({
    where: {
      farm_id: farmId,
      contract_id: settlement.contract_id,
      type: 'transfer',
      status: { in: ['finalized', 'pushed'] },
    },
    select: { id: true, net_amount: true, settlement_number: true },
  });

  const transferNet = transfers.reduce((s, t) => s + (t.net_amount || 0), 0);
  const buyerNet = settlement.net_amount || 0;
  const totalMt = settlement.lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0);
  const margin = buyerNet - transferNet;
  const marginPerMt = totalMt > 0 ? Math.round((margin / totalMt) * 100) / 100 : 0;
  const marginPct = buyerNet > 0 ? Math.round((margin / buyerNet) * 10000) / 100 : 0;

  const realization = {
    transfer_net: Math.round(transferNet * 100) / 100,
    buyer_net: Math.round(buyerNet * 100) / 100,
    margin: Math.round(margin * 100) / 100,
    margin_per_mt: marginPerMt,
    margin_pct: marginPct,
    total_mt: Math.round(totalMt * 100) / 100,
    transfer_count: transfers.length,
    transfer_ids: transfers.map(t => t.id),
    contract_number: settlement.contract?.contract_number,
  };

  // Save realization + paired transfer IDs
  await prisma.terminalSettlement.update({
    where: { id: settlementId },
    data: {
      realization_json: realization,
      paired_transfer_id: transfers.map(t => t.id).join(','),
    },
  });

  logger.info('Computed realization', { settlementId, ...realization });
  return realization;
}

/**
 * Finalize a buyer settlement — validates all lines matched and realization computed.
 */
export async function finalizeBuyerSettlement(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId, type: 'buyer_settlement' },
    include: { lines: true },
  });
  if (!settlement) throw Object.assign(new Error('Buyer settlement not found'), { status: 404 });
  if (settlement.status !== 'draft') {
    throw Object.assign(new Error(`Cannot finalize settlement with status "${settlement.status}"`), { status: 400 });
  }

  const unmatchedCount = settlement.lines.filter(l => l.match_status !== 'matched').length;
  if (unmatchedCount > 0) {
    throw Object.assign(
      new Error(`${unmatchedCount} line(s) still unmatched — reconcile all lines first`),
      { status: 400 },
    );
  }

  if (!settlement.realization_json) {
    throw Object.assign(new Error('Realization not computed — compute realization first'), { status: 400 });
  }

  return prisma.terminalSettlement.update({
    where: { id: settlementId },
    data: { status: 'finalized' },
    include: standardIncludes,
  });
}

/**
 * Push a finalized buyer settlement to logistics as a margin-only Settlement.
 * The existing transfer settlement ($600K) stays untouched.
 * Only the margin (buyer_net - transfer_net) gets pushed.
 */
export async function pushBuyerToLogistics(farmId, settlementId, io) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId, type: 'buyer_settlement' },
    include: {
      contract: {
        select: {
          id: true,
          contract_number: true,
          commodity: { select: { id: true, name: true, code: true } },
        },
      },
      counterparty: { select: { id: true, name: true, short_code: true } },
      lines: {
        include: {
          ticket: { select: { id: true, ticket_number: true, ticket_date: true } },
          commodity: { select: { id: true, name: true } },
        },
        orderBy: { line_number: 'asc' },
      },
    },
  });
  if (!settlement) throw Object.assign(new Error('Buyer settlement not found'), { status: 404 });
  if (settlement.status !== 'finalized') {
    throw Object.assign(new Error('Settlement must be finalized before pushing'), { status: 400 });
  }
  if (settlement.pushed_settlement_id) {
    throw Object.assign(new Error('Settlement has already been pushed'), { status: 400 });
  }

  const realization = settlement.realization_json;
  if (!realization) {
    throw Object.assign(new Error('Realization not computed'), { status: 400 });
  }

  // Resolve enterprise farm
  const { farmId: enterpriseFarmId } = await resolveInventoryFarm(farmId);

  // Find/create the actual buyer counterparty in enterprise context
  let buyerCounterparty = await prisma.counterparty.findFirst({
    where: {
      farm_id: enterpriseFarmId,
      name: { contains: settlement.counterparty?.name?.split(' ')[0] || '', mode: 'insensitive' },
      is_active: true,
    },
  });
  if (!buyerCounterparty) {
    buyerCounterparty = await prisma.counterparty.create({
      data: {
        farm_id: enterpriseFarmId,
        name: settlement.counterparty?.name || 'Unknown Buyer',
        short_code: settlement.counterparty?.short_code || 'UNK',
        type: 'buyer',
      },
    });
  }

  const contractNum = settlement.contract?.contract_number;
  const margin = realization.margin || 0;

  const result = await prisma.$transaction(async (tx) => {
    // Build settlement number for margin entry
    const existingCount = await tx.settlement.count({
      where: {
        farm_id: enterpriseFarmId,
        source: 'lgx_realization',
      },
    });
    const seq = String(existingCount + 1).padStart(3, '0');
    const settlementNum = `LGXM-${seq}-${contractNum || settlement.settlement_number}`;

    // Create margin-only logistics Settlement
    const logisticsSettlement = await tx.settlement.create({
      data: {
        farm_id: enterpriseFarmId,
        settlement_number: settlementNum,
        source: 'lgx_realization',
        terminal_settlement_id: settlement.id,
        counterparty_id: buyerCounterparty.id,
        settlement_date: settlement.settlement_date,
        total_amount: margin,
        settlement_gross: realization.buyer_net,
        status: 'approved', // auto-approve margin entries
        buyer_format: settlement.buyer_format || 'lgx',
        extraction_status: 'completed',
        extraction_json: {
          contract_number: contractNum || null,
          commodity: settlement.contract?.commodity?.name || null,
          source: 'lgx_realization',
          realization: realization,
        },
        reconciliation_report: realization,
        notes: `LGX Realization Margin - Contract #${contractNum || 'N/A'}`,
      },
    });

    // Update TerminalContract status → 'settled'
    if (settlement.contract_id) {
      await tx.terminalContract.update({
        where: { id: settlement.contract_id },
        data: { status: 'settled' },
      });

      // Update linked MarketingContract status → 'settled'
      const linkedMc = await tx.marketingContract.findFirst({
        where: { linked_terminal_contract_id: settlement.contract_id },
      });
      if (linkedMc) {
        await tx.marketingContract.update({
          where: { id: linkedMc.id },
          data: { status: 'settled' },
        });
        // Link settlement to marketing contract
        await tx.settlement.update({
          where: { id: logisticsSettlement.id },
          data: { marketing_contract_id: linkedMc.id },
        });
      }
    }

    // Mark terminal settlement as pushed
    await tx.terminalSettlement.update({
      where: { id: settlementId },
      data: {
        status: 'pushed',
        pushed_settlement_id: logisticsSettlement.id,
      },
    });

    return logisticsSettlement;
  });

  // Broadcast event
  if (io) {
    io.to(enterpriseFarmId).emit('settlement:created', { id: result.id });
  }

  logger.info('Pushed buyer settlement margin to logistics', {
    terminalSettlementId: settlementId,
    settlementId: result.id,
    margin,
    enterpriseFarmId,
  });

  return result;
}

/**
 * Manually match a buyer settlement line to an outbound ticket.
 */
export async function manualMatchBuyerLine(farmId, settlementId, lineId, ticketId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId, type: 'buyer_settlement' },
  });
  if (!settlement) throw Object.assign(new Error('Buyer settlement not found'), { status: 404 });
  if (settlement.status !== 'draft') {
    throw Object.assign(new Error('Can only match lines on draft settlements'), { status: 400 });
  }

  const line = await prisma.terminalSettlementLine.findFirst({
    where: { id: lineId, terminal_settlement_id: settlementId },
  });
  if (!line) throw Object.assign(new Error('Line not found'), { status: 404 });

  // Verify ticket belongs to this farm and is outbound
  const ticket = await prisma.terminalTicket.findFirst({
    where: { id: ticketId, farm_id: farmId, direction: 'outbound' },
  });
  if (!ticket) throw Object.assign(new Error('Outbound ticket not found'), { status: 404 });

  await prisma.terminalSettlementLine.update({
    where: { id: lineId },
    data: {
      ticket_id: ticketId,
      match_status: 'manual',
      match_confidence: 1.0,
    },
  });

  return getSettlement(farmId, settlementId);
}

/**
 * Generate a transloading invoice PDF for a settlement.
 */
export async function generateTransloadingInvoice(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: {
      counterparty: true,
      contract: { select: { contract_number: true } },
      lines: {
        include: {
          ticket: { select: { ticket_number: true, ticket_date: true } },
          commodity: { select: { name: true } },
        },
        orderBy: { line_number: 'asc' },
      },
    },
  });
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (settlement.type !== 'transloading') {
    throw Object.assign(new Error('Invoice generation is only for transloading settlements'), { status: 400 });
  }

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-CA') : '';
  const fmtNum = (n) => n != null ? n.toFixed(2) : '';
  const fmtCurrency = (n) => n != null ? `$${n.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '';

  const tableBody = [
    [
      { text: '#', style: 'tableHeader' },
      { text: 'Ticket', style: 'tableHeader' },
      { text: 'Date', style: 'tableHeader' },
      { text: 'Commodity', style: 'tableHeader' },
      { text: 'Grade', style: 'tableHeader' },
      { text: 'Net MT', style: 'tableHeader', alignment: 'right' },
      { text: '$/MT', style: 'tableHeader', alignment: 'right' },
      { text: 'Amount', style: 'tableHeader', alignment: 'right' },
    ],
  ];

  for (const line of settlement.lines) {
    tableBody.push([
      line.line_number,
      line.ticket?.ticket_number?.toString() || '',
      fmtDate(line.ticket?.ticket_date),
      line.commodity?.name || '',
      line.grade || '',
      { text: fmtNum(line.net_weight_mt), alignment: 'right' },
      { text: fmtNum(line.price_per_mt), alignment: 'right' },
      { text: fmtCurrency(line.line_amount), alignment: 'right' },
    ]);
  }

  // Total row
  tableBody.push([
    { text: 'TOTAL', colSpan: 5, bold: true }, {}, {}, {}, {},
    { text: fmtNum(settlement.lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0)), alignment: 'right', bold: true },
    {},
    { text: fmtCurrency(settlement.net_amount), alignment: 'right', bold: true },
  ]);

  const docDefinition = {
    content: [
      { text: 'LGX Terminals', style: 'companyName' },
      { text: 'Transloading Invoice', style: 'title', margin: [0, 5, 0, 15] },
      {
        columns: [
          {
            width: '50%',
            stack: [
              { text: 'Bill To:', bold: true },
              { text: settlement.counterparty?.name || 'Unknown' },
            ],
          },
          {
            width: '50%',
            alignment: 'right',
            stack: [
              { text: `Invoice #: ${settlement.settlement_number}`, bold: true },
              { text: `Date: ${fmtDate(settlement.settlement_date)}` },
              settlement.contract ? { text: `Contract: ${settlement.contract.contract_number}` } : {},
            ],
          },
        ],
      },
      { text: '', margin: [0, 10] },
      {
        table: {
          headerRows: 1,
          widths: [20, 50, 60, 70, 60, 55, 55, 65],
          body: tableBody,
        },
        layout: 'lightHorizontalLines',
      },
      settlement.notes ? { text: `\nNotes: ${settlement.notes}`, margin: [0, 10], italics: true } : {},
    ],
    styles: {
      companyName: { fontSize: 16, bold: true },
      title: { fontSize: 14 },
      tableHeader: { bold: true, fontSize: 9 },
    },
    defaultStyle: { fontSize: 9 },
  };

  const fontPaths = getFontPaths();
  const printer = new PdfPrinter({ Roboto: fontPaths });
  const pdfDoc = printer.createPdfKitDocument(docDefinition);

  return new Promise((resolve, reject) => {
    const chunks = [];
    pdfDoc.on('data', (chunk) => chunks.push(chunk));
    pdfDoc.on('end', () => resolve(Buffer.concat(chunks)));
    pdfDoc.on('error', reject);
    pdfDoc.end();
  });
}
