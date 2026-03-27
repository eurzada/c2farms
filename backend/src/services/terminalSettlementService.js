import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { resolveInventoryFarm } from './resolveInventoryFarm.js';
import { getOrCreateLgxCounterparty } from './marketingService.js';
import { extractSettlementFromPdf } from './settlementService.js';
import { processBuCreditCascade } from './buCreditAllocationService.js';
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
 * Reverse the delivered_mt bump on a TerminalContract for a given settlement.
 * Shared by revertToDraft and deleteSettlement.
 */
async function reverseContractDelivery(tx, settlement) {
  const totalSettledMt = (settlement.lines || []).reduce((s, l) => s + (l.net_weight_mt || 0), 0);
  if (settlement.contract_id && totalSettledMt > 0) {
    const contract = await tx.terminalContract.findUnique({
      where: { id: settlement.contract_id },
    });
    if (contract) {
      const newDelivered = Math.max(0, (contract.delivered_mt || 0) - totalSettledMt);
      const rawRemaining = contract.contracted_mt - newDelivered;
      const newRemaining = rawRemaining < 0.5 ? 0 : rawRemaining;
      const newStatus = newDelivered <= 0 ? 'executed' : 'in_delivery';
      await tx.terminalContract.update({
        where: { id: contract.id },
        data: { delivered_mt: newDelivered, remaining_mt: newRemaining, status: newStatus },
      });
      logger.info('Reversed contract delivery totals', {
        contractId: contract.id, delivered: newDelivered, remaining: newRemaining, status: newStatus,
      });
    }
  }
}

/**
 * Revert a finalized settlement back to draft so pricing can be re-applied.
 * Reverses the delivered_mt bump that finalizeSettlement added to the contract.
 */
export async function revertToDraft(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: { lines: true },
  });
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (settlement.status === 'draft') {
    throw Object.assign(new Error('Settlement is already a draft'), { status: 400 });
  }
  if (settlement.status === 'pushed') {
    throw Object.assign(new Error('Cannot revert a pushed settlement — un-push it first'), { status: 400 });
  }

  return prisma.$transaction(async (tx) => {
    // Reverse contract delivered_mt that finalize added
    await reverseContractDelivery(tx, settlement);

    return tx.terminalSettlement.update({
      where: { id: settlementId },
      data: { status: 'draft' },
      include: standardIncludes,
    });
  });
}

/**
 * Push a finalized terminal settlement into the enterprise logistics pipeline
 * as a Settlement record. THE KEY FUNCTION.
 */
export async function pushToLogistics(farmId, settlementId, io, options = {}) {
  const { reconciledPairs } = options; // Optional Map(terminalTicketId → deliveryTicketId)
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
        status: reconciledPairs ? 'reconciled' : 'pending',
        buyer_format: 'lgx',
        extraction_status: 'completed',
        extraction_json: {
          contract_number: contractNum || null,
          commodity: terminalSettlement.contract?.commodity?.name || null,
        },
      },
    });

    // 4b. Match terminal ticket numbers → DeliveryTickets for auto-reconciliation
    // When reconciledPairs is provided, use pre-reconciled mapping instead of ticket_number lookup
    let dtMap;
    if (reconciledPairs && reconciledPairs.size > 0) {
      // Pre-reconciled: map terminal ticket IDs → delivery ticket IDs directly
      dtMap = new Map();
      for (const line of terminalSettlement.lines) {
        if (line.ticket?.id && reconciledPairs.has(line.ticket.id)) {
          dtMap.set(line.ticket.id, reconciledPairs.get(line.ticket.id));
        }
      }
    } else {
      // Default: match by ticket_number string
      const ticketNumbers = terminalSettlement.lines
        .filter(l => l.ticket?.ticket_number)
        .map(l => String(l.ticket.ticket_number));

      const deliveryTickets = ticketNumbers.length > 0
        ? await tx.deliveryTicket.findMany({
            where: { farm_id: enterpriseFarmId, ticket_number: { in: ticketNumbers } },
            select: { id: true, ticket_number: true },
          })
        : [];
      dtMap = new Map(deliveryTickets.map(dt => [dt.ticket_number, dt.id]));
    }

    const useTicketIdLookup = reconciledPairs && reconciledPairs.size > 0;

    // 4c. Create SettlementLine records — auto-matched where possible
    const lineData = terminalSettlement.lines.map(line => {
      const ticketNum = line.ticket?.ticket_number?.toString() || null;
      let deliveryTicketId;
      if (useTicketIdLookup) {
        deliveryTicketId = line.ticket?.id ? dtMap.get(line.ticket.id) || null : null;
      } else {
        deliveryTicketId = ticketNum ? dtMap.get(ticketNum) || null : null;
      }
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
export async function getEligibleTickets(farmId, type = 'transfer', { contractId } = {}) {
  const isC2 = type === 'transfer';

  const where = {
    farm_id: farmId,
    direction: 'inbound',
    is_c2_farms: isC2,
    status: 'complete',
    terminal_settlement_lines: { none: {} },
  };

  // When a contract is selected, filter to tickets assigned to that contract
  // or matching the contract's commodity (by product string)
  if (contractId) {
    const contract = await prisma.terminalContract.findUnique({
      where: { id: contractId },
      select: { commodity: { select: { name: true, code: true } } },
    });
    if (contract?.commodity) {
      const commodityName = contract.commodity.name;
      const commodityCode = contract.commodity.code;
      // Match tickets assigned to this contract OR with matching product
      where.OR = [
        { contract_id: contractId },
        { product: { contains: commodityCode || commodityName, mode: 'insensitive' } },
      ];
    }
  }

  const tickets = await prisma.terminalTicket.findMany({
    where,
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
      contract_id: true,
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

  // 3. Check if this should use the three-party grain sale flow instead
  if (extraction.contract_number) {
    const { farmId: enterpriseFarmId } = await resolveInventoryFarm(farmId);
    const terminalRoutedMc = await prisma.marketingContract.findFirst({
      where: {
        farm_id: enterpriseFarmId,
        contract_number: extraction.contract_number,
        delivery_method: 'terminal',
      },
    });
    if (terminalRoutedMc) {
      logger.info('Detected terminal-routed MarketingContract %s — redirecting to grain sale flow', extraction.contract_number);
      // Reuse already-extracted data to avoid double extraction
      return _createGrainSaleFromExtraction(farmId, extraction, buyerFormat, usage, terminalRoutedMc.id);
    }
  }

  // 3b. Auto-link to TerminalContract by contract_number (direction='sale') — non-C2 grain flow
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
    where: { id: settlementId, farm_id: farmId, type: { in: ['buyer_settlement', 'grain_sale'] } },
    include: {
      contract: { select: { id: true, contract_number: true } },
      lines: true,
    },
  });
  if (!settlement) throw Object.assign(new Error('Buyer settlement not found'), { status: 404 });

  if (!settlement.contract_id) {
    throw Object.assign(new Error('No contract linked to this buyer settlement'), { status: 400 });
  }

  // Guard: if linked MarketingContract is terminal-routed C2 grain, use new workflow
  if (settlement.contract_id) {
    const linkedMc = await prisma.marketingContract.findFirst({
      where: { linked_terminal_contract_id: settlement.contract_id },
    });
    if (linkedMc?.delivery_method === 'terminal') {
      throw Object.assign(new Error(
        'This contract uses the three-party workflow. Use grain-sale/reconcile-tonnage and grain-sale/approve-tonnage instead of computeRealization.'
      ), { status: 400 });
    }
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
    where: { id: settlementId, farm_id: farmId, type: { in: ['buyer_settlement', 'grain_sale'] } },
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

  // Guard: if linked MarketingContract is terminal-routed C2 grain, use new workflow
  if (settlement.contract_id) {
    const linkedMc = await prisma.marketingContract.findFirst({
      where: { linked_terminal_contract_id: settlement.contract_id },
    });
    if (linkedMc?.delivery_method === 'terminal') {
      throw Object.assign(new Error(
        'This contract uses the three-party workflow. Use uploadGrainSaleSettlementPdf and approveTerminalTonnageRecon instead.'
      ), { status: 400 });
    }
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

      // Update linked MarketingContract status → 'fulfilled'
      const linkedMc = await tx.marketingContract.findFirst({
        where: { linked_terminal_contract_id: settlement.contract_id },
      });
      if (linkedMc) {
        await tx.marketingContract.update({
          where: { id: linkedMc.id },
          data: { status: 'fulfilled' },
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

/**
 * Delete a terminal settlement, reversing contract delivery totals and
 * cleaning up linked logistics settlements as needed.
 */
export async function deleteSettlement(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: { lines: true },
  });
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });

  return prisma.$transaction(async (tx) => {
    // For finalized settlements, reverse the contract delivery bump
    if (settlement.status === 'finalized') {
      await reverseContractDelivery(tx, settlement);
    }

    // For pushed settlements, also delete the linked logistics Settlement
    if (settlement.status === 'pushed' && settlement.pushed_settlement_id) {
      // For transfer settlements, reverse contract delivery AND delete logistics settlement
      if (settlement.type === 'transfer' || settlement.type === 'transloading') {
        await reverseContractDelivery(tx, settlement);

        // Also reverse MarketingContract delivery if applicable
        if (settlement.contract_id) {
          const linkedMc = await tx.marketingContract.findFirst({
            where: { linked_terminal_contract_id: settlement.contract_id },
          });
          if (linkedMc) {
            const totalMt = settlement.lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0);
            const newDelivered = Math.max(0, (linkedMc.delivered_mt || 0) - totalMt);
            const rawRemaining = linkedMc.contracted_mt - newDelivered;
            const newRemaining = rawRemaining < 0.5 ? 0 : rawRemaining;
            const newStatus = newDelivered <= 0 ? 'executed' : 'in_delivery';
            await tx.marketingContract.update({
              where: { id: linkedMc.id },
              data: { delivered_mt: newDelivered, remaining_mt: newRemaining, status: newStatus },
            });
          }
        }
      }

      // buyer_settlement pushed settlements: delete logistics settlement, no contract reversal needed

      // Delete logistics Settlement (cascades to SettlementLine via Prisma)
      await tx.settlement.delete({
        where: { id: settlement.pushed_settlement_id },
      });
    }

    // Delete the terminal settlement (lines cascade via onDelete: Cascade)
    await tx.terminalSettlement.delete({
      where: { id: settlementId },
    });

    logger.info('Deleted terminal settlement', {
      id: settlementId, type: settlement.type, status: settlement.status,
    });

    return { success: true };
  });
}

/**
 * Load a single settlement with paired data (transfers, buyer settlement,
 * linked MarketingContract) based on settlement type.
 */
export async function getSettlementWithPairedData(farmId, settlementId) {
  const settlement = await prisma.terminalSettlement.findFirst({
    where: { id: settlementId, farm_id: farmId },
    include: standardIncludes,
  });
  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });

  // Load paired data based on settlement type
  if (settlement.contract_id) {
    if (settlement.type === 'buyer_settlement') {
      // Load transfer settlements on the same contract
      const pairedTransfers = await prisma.terminalSettlement.findMany({
        where: {
          farm_id: farmId,
          contract_id: settlement.contract_id,
          type: { in: ['transfer', 'transloading'] },
        },
        include: {
          counterparty: { select: { id: true, name: true } },
        },
        orderBy: { settlement_date: 'asc' },
      });
      settlement.paired_transfers = pairedTransfers;
    } else if (settlement.type === 'transfer' || settlement.type === 'transloading') {
      // Load any buyer settlement on the same contract
      const pairedBuyer = await prisma.terminalSettlement.findFirst({
        where: {
          farm_id: farmId,
          contract_id: settlement.contract_id,
          type: 'buyer_settlement',
        },
        include: {
          counterparty: { select: { id: true, name: true } },
        },
      });
      settlement.paired_buyer = pairedBuyer || null;
    }

    // Load linked MarketingContract
    const linkedMc = await prisma.marketingContract.findFirst({
      where: { linked_terminal_contract_id: settlement.contract_id },
      include: {
        counterparty: { select: { id: true, name: true } },
        commodity: { select: { id: true, name: true, code: true } },
      },
    });
    settlement.linked_marketing_contract = linkedMc || null;
  }

  return settlement;
}

// ─── Three-Party Workflow: Grain Sale Settlement (C2 → Buyer via Terminal) ──

/**
 * Upload a buyer settlement PDF for a terminal-routed grain sale contract.
 * Unlike uploadBuyerSettlementPdf (which creates a TerminalSettlement),
 * this creates an enterprise Settlement directly linked to the MarketingContract.
 *
 * Flow: PDF → extract → create enterprise Settlement → ready for tonnage recon
 *
 * @param {string} terminalFarmId - LGX terminal farm ID
 * @param {Buffer} pdfBuffer - PDF file buffer
 * @param {string} filename - Original filename
 * @param {string} [marketingContractId] - Optional: pre-link to MarketingContract
 * @returns {{ settlement, extraction, usage }}
 */
export async function uploadGrainSaleSettlementPdf(terminalFarmId, pdfBuffer, filename, marketingContractId) {
  logger.info('Uploading grain sale settlement PDF (three-party)', { terminalFarmId, filename });

  // 1. Extract via Claude Vision
  const { extraction, buyerFormat, usage } = await extractSettlementFromPdf(pdfBuffer);

  return _createGrainSaleFromExtraction(terminalFarmId, extraction, buyerFormat, usage, marketingContractId);
}

/**
 * Internal helper: create a grain sale enterprise Settlement from pre-extracted PDF data.
 * Called by uploadGrainSaleSettlementPdf directly, or via uploadBuyerSettlementPdf redirect.
 */
async function _createGrainSaleFromExtraction(terminalFarmId, extraction, buyerFormat, usage, marketingContractId) {
  // 2. Resolve enterprise farm
  const { farmId: enterpriseFarmId } = await resolveInventoryFarm(terminalFarmId);

  // 3. Find counterparty in enterprise context
  const buyerName = extraction.buyer || '';
  let counterparty = await prisma.counterparty.findFirst({
    where: {
      farm_id: enterpriseFarmId,
      name: { contains: buyerName.split(' ')[0], mode: 'insensitive' },
      is_active: true,
    },
  });
  if (!counterparty) {
    counterparty = await prisma.counterparty.create({
      data: {
        farm_id: enterpriseFarmId,
        name: buyerName || 'Unknown Buyer',
        short_code: (buyerName || 'UNK').substring(0, 4).toUpperCase(),
        type: 'buyer',
      },
    });
  }

  // 4. Auto-link to MarketingContract by contract_number
  let mcId = marketingContractId || null;
  if (!mcId && extraction.contract_number) {
    const mc = await prisma.marketingContract.findFirst({
      where: {
        farm_id: enterpriseFarmId,
        contract_number: extraction.contract_number,
        delivery_method: 'terminal',
      },
    });
    if (mc) mcId = mc.id;
  }

  // 5. Build amounts
  const deductionsSummary = extraction.deductions_summary || [];
  const totalDeductions = deductionsSummary.reduce((s, d) => s + (d.amount || 0), 0);
  const grossAmount = extraction.total_gross_amount || extraction.settlement_gross || 0;
  const netAmount = extraction.total_net_amount || (grossAmount + totalDeductions) || 0;

  // 6. Build settlement number
  const settlementNumber = extraction.settlement_number
    ? `GS-${extraction.settlement_number}`
    : `GS-${Date.now()}`;

  // 7. Build lines from extraction
  const lines = (extraction.lines || []).map((line, idx) => ({
    line_number: line.line_number ?? (idx + 1),
    ticket_number_on_settlement: line.ticket_number ? String(line.ticket_number) : null,
    contract_number: extraction.contract_number || null,
    delivery_date: line.delivery_date ? new Date(line.delivery_date) : null,
    commodity: extraction.commodity || null,
    grade: line.grade || null,
    gross_weight_mt: line.gross_weight_mt ?? null,
    net_weight_mt: line.net_weight_mt ?? null,
    price_per_mt: line.price_per_mt ?? null,
    price_per_bu: line.price_per_bu ?? null,
    line_gross: line.line_gross ?? null,
    line_net: line.line_net ?? (line.net_weight_mt && line.price_per_mt ? line.net_weight_mt * line.price_per_mt : null),
    match_status: 'unmatched',
    match_confidence: null,
  }));

  // 8. Create enterprise Settlement (not TerminalSettlement)
  const settlement = await prisma.settlement.create({
    data: {
      farm_id: enterpriseFarmId,
      settlement_number: settlementNumber,
      source: 'terminal_grain_sale',
      counterparty_id: counterparty.id,
      marketing_contract_id: mcId,
      settlement_date: extraction.settlement_date ? new Date(extraction.settlement_date) : new Date(),
      total_amount: netAmount,
      settlement_gross: grossAmount,
      deductions_summary: deductionsSummary,
      status: 'pending',
      buyer_format: buyerFormat,
      extraction_status: 'completed',
      extraction_json: extraction,
      usage_json: usage,
      notes: `Grain sale settlement via LGX terminal${extraction.contract_number ? ` - Contract #${extraction.contract_number}` : ''}`,
      lines: { create: lines },
    },
    include: {
      counterparty: { select: { id: true, name: true, short_code: true } },
      marketing_contract: { select: { id: true, contract_number: true, delivery_method: true } },
      lines: { orderBy: { line_number: 'asc' } },
    },
  });

  logger.info('Created grain sale enterprise settlement', {
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
 * Tonnage-level reconciliation for a terminal-routed settlement.
 * Instead of matching individual tickets, aggregates MT at the contract level.
 *
 * Compares:
 * - C2 side: DeliveryTickets (Traction Ag) shipped to LGX
 * - LGX inbound: TerminalTickets (inbound, is_c2_farms=true)
 * - LGX outbound: TerminalTickets (outbound)
 * - Buyer side: Settlement lines (rail cars)
 *
 * @param {string} terminalFarmId - LGX terminal farm ID
 * @param {string} settlementId - Enterprise Settlement ID
 * @returns {Object} Tonnage reconciliation summary with three layers
 */
export async function reconcileTerminalTonnage(terminalFarmId, settlementId) {
  const { farmId: enterpriseFarmId } = await resolveInventoryFarm(terminalFarmId);

  // Load the enterprise settlement
  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, farm_id: enterpriseFarmId },
    include: {
      lines: { orderBy: { line_number: 'asc' } },
      marketing_contract: {
        select: {
          id: true,
          contract_number: true,
          contracted_mt: true,
          delivered_mt: true,
          delivery_method: true,
          terminal_farm_id: true,
          grade_prices_json: true,
          commodity: { select: { id: true, name: true, code: true } },
          counterparty: { select: { id: true, name: true } },
        },
      },
    },
  });

  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (!settlement.marketing_contract) {
    throw Object.assign(new Error('Settlement not linked to a MarketingContract'), { status: 400 });
  }
  if (settlement.marketing_contract.delivery_method !== 'terminal') {
    throw Object.assign(new Error('Contract is not terminal-routed — use standard reconciliation'), { status: 400 });
  }

  const mc = settlement.marketing_contract;
  const resolvedTerminalFarmId = mc.terminal_farm_id || terminalFarmId;

  // Layer 1: C2 DeliveryTickets → LGX (what C2 shipped)
  const deliveryTickets = await prisma.deliveryTicket.findMany({
    where: {
      farm_id: enterpriseFarmId,
      marketing_contract_id: mc.id,
    },
    select: {
      id: true, ticket_number: true, delivery_date: true,
      net_weight_mt: true, net_weight_kg: true, grade: true,
      location: { select: { name: true } },
    },
  });

  // Layer 1b: LGX inbound TerminalTickets (C2 grain for this contract)
  const inboundTickets = await prisma.terminalTicket.findMany({
    where: {
      farm_id: resolvedTerminalFarmId,
      direction: 'inbound',
      is_c2_farms: true,
      marketing_contract_id: mc.id,
      status: 'complete',
    },
    select: {
      id: true, ticket_number: true, ticket_date: true,
      weight_kg: true, grower_name: true, product: true,
    },
  });

  // Layer 2: LGX outbound TerminalTickets (shipped to buyer)
  const outboundTickets = await prisma.terminalTicket.findMany({
    where: {
      farm_id: resolvedTerminalFarmId,
      direction: 'outbound',
      marketing_contract_id: mc.id,
      status: 'complete',
    },
    select: {
      id: true, ticket_number: true, ticket_date: true,
      weight_kg: true, rail_car_number: true, sold_to: true,
    },
  });

  // Layer 3: Settlement lines (what buyer settled)
  const settledMt = settlement.lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0);
  const settledGross = settlement.settlement_gross || 0;
  const settledNet = settlement.total_amount || 0;

  // Aggregate
  const c2ShippedMt = deliveryTickets.reduce((s, t) => s + (t.net_weight_mt || (t.net_weight_kg || 0) / 1000), 0);
  const lgxInboundMt = inboundTickets.reduce((s, t) => s + ((t.weight_kg || 0) / 1000), 0);
  const lgxOutboundMt = outboundTickets.reduce((s, t) => s + ((t.weight_kg || 0) / 1000), 0);

  // Variance calculations
  const c2VsLgxVariance = c2ShippedMt > 0 ? ((lgxInboundMt - c2ShippedMt) / c2ShippedMt * 100) : null;
  const lgxVsSettledVariance = lgxOutboundMt > 0 ? ((settledMt - lgxOutboundMt) / lgxOutboundMt * 100) : null;
  const overallVariance = c2ShippedMt > 0 ? ((settledMt - c2ShippedMt) / c2ShippedMt * 100) : null;

  // BU breakdown (from inbound tickets)
  const buBreakdown = new Map();
  for (const t of inboundTickets) {
    const bu = t.grower_name || 'Unknown';
    if (!buBreakdown.has(bu)) buBreakdown.set(bu, { mt: 0, tickets: 0 });
    const group = buBreakdown.get(bu);
    group.mt += (t.weight_kg || 0) / 1000;
    group.tickets += 1;
  }

  const summary = {
    contract: {
      id: mc.id,
      contract_number: mc.contract_number,
      contracted_mt: mc.contracted_mt,
      commodity: mc.commodity?.name,
      counterparty: mc.counterparty?.name,
      has_grade_prices: Array.isArray(mc.grade_prices_json) && mc.grade_prices_json.length > 0,
    },
    layers: {
      c2_shipped: {
        total_mt: Math.round(c2ShippedMt * 1000) / 1000,
        ticket_count: deliveryTickets.length,
        source: 'DeliveryTicket (Traction Ag)',
      },
      lgx_inbound: {
        total_mt: Math.round(lgxInboundMt * 1000) / 1000,
        ticket_count: inboundTickets.length,
        source: 'TerminalTicket (inbound)',
      },
      lgx_outbound: {
        total_mt: Math.round(lgxOutboundMt * 1000) / 1000,
        ticket_count: outboundTickets.length,
        source: 'TerminalTicket (outbound)',
      },
      settled: {
        total_mt: Math.round(settledMt * 1000) / 1000,
        line_count: settlement.lines.length,
        gross_amount: settledGross,
        net_amount: settledNet,
        source: 'Settlement lines (buyer)',
      },
    },
    variances: {
      c2_vs_lgx_inbound_pct: c2VsLgxVariance != null ? Math.round(c2VsLgxVariance * 100) / 100 : null,
      lgx_outbound_vs_settled_pct: lgxVsSettledVariance != null ? Math.round(lgxVsSettledVariance * 100) / 100 : null,
      overall_pct: overallVariance != null ? Math.round(overallVariance * 100) / 100 : null,
    },
    bu_breakdown: Array.from(buBreakdown.entries()).map(([name, data]) => ({
      bu_farm_name: name,
      contributed_mt: Math.round(data.mt * 1000) / 1000,
      ticket_count: data.tickets,
    })),
    recommendation: Math.abs(overallVariance || 0) <= 5
      ? 'APPROVE — variance within normal range (<=5%)'
      : 'REVIEW — variance exceeds 5%, investigate before approving',
  };

  logger.info('Tonnage reconciliation computed', {
    settlementId,
    contractNumber: mc.contract_number,
    c2Mt: c2ShippedMt,
    lgxInMt: lgxInboundMt,
    lgxOutMt: lgxOutboundMt,
    settledMt,
    overallVariance,
  });

  return summary;
}

/**
 * Approve a tonnage reconciliation — triggers BU credit cascade and updates contract.
 *
 * @param {string} terminalFarmId - LGX terminal farm ID
 * @param {string} settlementId - Enterprise Settlement ID
 * @param {Object} io - Socket.io instance
 * @returns {{ settlement, contract, buCredits }}
 */
export async function approveTerminalTonnageRecon(terminalFarmId, settlementId, io) {
  const { farmId: enterpriseFarmId } = await resolveInventoryFarm(terminalFarmId);

  const settlement = await prisma.settlement.findFirst({
    where: { id: settlementId, farm_id: enterpriseFarmId },
    include: {
      marketing_contract: {
        select: {
          id: true,
          contract_number: true,
          contracted_mt: true,
          delivery_method: true,
          terminal_farm_id: true,
          counterparty_id: true,
        },
      },
      lines: true,
    },
  });

  if (!settlement) throw Object.assign(new Error('Settlement not found'), { status: 404 });
  if (settlement.status === 'approved') {
    throw Object.assign(new Error('Settlement already approved'), { status: 400 });
  }
  if (!settlement.marketing_contract) {
    throw Object.assign(new Error('No MarketingContract linked'), { status: 400 });
  }
  if (settlement.marketing_contract.delivery_method !== 'terminal') {
    throw Object.assign(new Error('Contract is not terminal-routed'), { status: 400 });
  }

  const mc = settlement.marketing_contract;
  const resolvedTerminalFarmId = mc.terminal_farm_id || terminalFarmId;
  const netAmount = settlement.total_amount || 0;
  const settledMt = settlement.lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0);

  // 1. Approve the settlement
  await prisma.settlement.update({
    where: { id: settlementId },
    data: {
      status: 'approved',
      reconciliation_report: {
        type: 'terminal_tonnage',
        approved_at: new Date().toISOString(),
        settled_mt: settledMt,
        net_amount: netAmount,
      },
    },
  });

  // 2. Mark all settlement lines as matched (tonnage-level approval)
  await prisma.settlementLine.updateMany({
    where: { settlement_id: settlementId },
    data: { match_status: 'matched', match_confidence: 1.0 },
  });

  // 3. Update MarketingContract
  const newDelivered = settledMt;
  const rawRemaining = mc.contracted_mt - newDelivered;
  const newRemaining = rawRemaining < 0.5 ? 0 : rawRemaining;
  const newStatus = newRemaining <= 0 ? 'fulfilled' : 'in_delivery';

  await prisma.marketingContract.update({
    where: { id: mc.id },
    data: {
      delivered_mt: newDelivered,
      remaining_mt: newRemaining,
      status: newStatus,
      settlement_amount: netAmount,
    },
  });

  // 4. Trigger BU credit cascade
  let buCredits = { allocations: [], settlements: [] };
  try {
    buCredits = await processBuCreditCascade(
      resolvedTerminalFarmId,
      mc.id,
      netAmount,
      mc.counterparty_id,
      io
    );
  } catch (err) {
    logger.warn('BU credit cascade failed (non-fatal): %s', err.message);
    // Non-fatal — settlement is still approved, BU credits can be retried
  }

  // 5. Broadcast
  if (io) {
    io.to(enterpriseFarmId).emit('settlement:approved', {
      id: settlementId,
      contract_number: mc.contract_number,
      bu_credits: buCredits.allocations?.length || 0,
    });
  }

  logger.info('Tonnage recon approved with BU credits', {
    settlementId,
    contractNumber: mc.contract_number,
    settledMt,
    netAmount,
    buCredits: buCredits.allocations?.length || 0,
  });

  return {
    settlement: { id: settlementId, status: 'approved' },
    contract: { id: mc.id, status: newStatus, delivered_mt: newDelivered },
    buCredits,
  };
}

// ─── Transloading Service Fee ───────────────────────────────────────────────

/**
 * Auto-generate a transloading settlement from outbound tickets for a transloading contract.
 * Sums outbound ticket tonnage and applies the transloading rate from the contract.
 *
 * @param {string} farmId - LGX terminal farm ID
 * @param {string} contractId - TerminalContract ID (contract_purpose='transloading_service')
 * @returns {Object} Created TerminalSettlement with lines
 */
export async function generateTransloadingSettlement(farmId, contractId) {
  // Load the transloading contract
  const contract = await prisma.terminalContract.findFirst({
    where: { id: contractId, farm_id: farmId },
    include: {
      counterparty: { select: { id: true, name: true } },
      commodity: { select: { id: true, name: true, code: true } },
      marketing_contract: { select: { id: true, contract_number: true } },
    },
  });

  if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });
  if (contract.contract_purpose !== 'transloading_service') {
    throw Object.assign(new Error('Contract is not a transloading service agreement'), { status: 400 });
  }
  if (!contract.transloading_rate || contract.transloading_rate <= 0) {
    throw Object.assign(new Error('No transloading rate set on contract'), { status: 400 });
  }

  // Find outbound tickets linked to the associated marketing contract
  const mcId = contract.marketing_contract_id;
  const outboundWhere = {
    farm_id: farmId,
    direction: 'outbound',
    status: 'complete',
  };
  // Link via marketing_contract_id if available, else via assigned contract_id
  if (mcId) {
    outboundWhere.marketing_contract_id = mcId;
  } else {
    outboundWhere.contract_id = contractId;
  }

  const outboundTickets = await prisma.terminalTicket.findMany({
    where: outboundWhere,
    select: {
      id: true,
      ticket_number: true,
      ticket_date: true,
      weight_kg: true,
      rail_car_number: true,
      product: true,
      sold_to: true,
    },
    orderBy: { ticket_date: 'asc' },
  });

  if (outboundTickets.length === 0) {
    throw Object.assign(new Error('No outbound tickets found for this contract'), { status: 400 });
  }

  const rate = contract.transloading_rate;
  const lines = outboundTickets.map((ticket, idx) => {
    const mt = (ticket.weight_kg || 0) / 1000;
    return {
      line_number: idx + 1,
      ticket_id: ticket.id,
      source_farm_name: ticket.rail_car_number || `Ticket #${ticket.ticket_number}`,
      commodity_id: contract.commodity_id || null,
      grade: null,
      gross_weight_mt: mt,
      tare_weight_mt: null,
      net_weight_mt: mt,
      price_per_mt: rate,
      line_amount: Math.round(mt * rate * 100) / 100,
      match_status: 'matched',
      match_confidence: 1.0,
    };
  });

  const grossAmount = lines.reduce((s, l) => s + (l.line_amount || 0), 0);

  // Generate settlement number
  const existingCount = await prisma.terminalSettlement.count({
    where: { farm_id: farmId, type: 'transloading' },
  });
  const seq = String(existingCount + 1).padStart(3, '0');
  const mcNum = contract.marketing_contract?.contract_number || contract.contract_number;
  const settlementNumber = `TL-${seq}-${mcNum}`;

  const settlement = await prisma.terminalSettlement.create({
    data: {
      farm_id: farmId,
      type: 'transloading',
      settlement_number: settlementNumber,
      counterparty_id: contract.counterparty_id,
      contract_id: contractId,
      marketing_contract_id: mcId || null,
      settlement_date: new Date(),
      gross_amount: grossAmount,
      net_amount: grossAmount,
      status: 'draft',
      notes: `Transloading fee: ${outboundTickets.length} loads × $${rate}/MT = $${grossAmount.toFixed(2)}`,
      lines: { create: lines },
    },
    include: standardIncludes,
  });

  logger.info('Generated transloading settlement', {
    id: settlement.id,
    contractId,
    loads: outboundTickets.length,
    totalMt: lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0),
    rate,
    amount: grossAmount,
  });

  return settlement;
}

/**
 * Get LGX transloading revenue summary.
 * Aggregates transloading settlements by buyer, contract, and month.
 *
 * @param {string} farmId - LGX terminal farm ID
 * @returns {Object} Revenue summary
 */
export async function getTransloadingRevenueSummary(farmId) {
  const settlements = await prisma.terminalSettlement.findMany({
    where: {
      farm_id: farmId,
      type: 'transloading',
    },
    include: {
      counterparty: { select: { id: true, name: true, short_code: true } },
      contract: {
        select: {
          id: true, contract_number: true, transloading_rate: true,
          marketing_contract: { select: { contract_number: true } },
        },
      },
    },
    orderBy: { settlement_date: 'desc' },
  });

  // By buyer
  const byBuyer = new Map();
  for (const s of settlements) {
    const buyerName = s.counterparty?.name || 'Unknown';
    if (!byBuyer.has(buyerName)) byBuyer.set(buyerName, { count: 0, total: 0, mt: 0 });
    const group = byBuyer.get(buyerName);
    group.count += 1;
    group.total += s.net_amount || 0;
  }

  // By month
  const byMonth = new Map();
  for (const s of settlements) {
    const month = s.settlement_date ? new Date(s.settlement_date).toISOString().slice(0, 7) : 'unknown';
    if (!byMonth.has(month)) byMonth.set(month, { count: 0, total: 0 });
    const group = byMonth.get(month);
    group.count += 1;
    group.total += s.net_amount || 0;
  }

  const totalRevenue = settlements.reduce((s, t) => s + (t.net_amount || 0), 0);
  const draftAmount = settlements.filter(s => s.status === 'draft').reduce((s, t) => s + (t.net_amount || 0), 0);
  const finalizedAmount = settlements.filter(s => s.status !== 'draft').reduce((s, t) => s + (t.net_amount || 0), 0);

  return {
    total_revenue: Math.round(totalRevenue * 100) / 100,
    draft_amount: Math.round(draftAmount * 100) / 100,
    finalized_amount: Math.round(finalizedAmount * 100) / 100,
    settlement_count: settlements.length,
    by_buyer: Array.from(byBuyer.entries()).map(([name, data]) => ({
      buyer: name,
      ...data,
      total: Math.round(data.total * 100) / 100,
    })),
    by_month: Array.from(byMonth.entries()).map(([month, data]) => ({
      month,
      ...data,
      total: Math.round(data.total * 100) / 100,
    })).sort((a, b) => b.month.localeCompare(a.month)),
    settlements,
  };
}
