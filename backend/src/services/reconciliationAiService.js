import prisma from '../config/database.js';

/**
 * Reconciliation service for matching settlement lines to delivery tickets.
 *
 * Two-phase matching:
 *   Phase 1 (deterministic): Ticket number is an exact match or nothing.
 *     Buyer systems (Cargill, Richardson, Bunge, JGL) use precise, controlled
 *     numbering — there is no "close" ticket number.
 *   Phase 2 (scored fallback): For lines without a ticket-number match,
 *     score on operational data: weight + commodity + date + contract.
 */

const WEIGHT_TOLERANCE_PCT = 0.03; // 3% tolerance (settlement net includes dockage deductions)
const DATE_TOLERANCE_DAYS = 3;     // ±3 days for date proximity

// Map common western Canadian grain grade designations to commodity names
const GRADE_TO_COMMODITY = {
  '1 canada': 'canola', '2 canada': 'canola', '1 ce': 'canola',
  '1 cw': 'durum', '2 cw': 'durum', '3 cw': 'durum', '1 cwad': 'durum', '2 cwad': 'durum',
  '2 can': 'lentils', '1 can': 'lentils', 'no. 1': 'lentils',
  '1 ca': 'chickpeas', '2 ca': 'chickpeas',
  '1 cw red spring': 'wheat', '2 cw red spring': 'wheat',
};

/**
 * Parse a ticket number to a numeric value for comparison.
 * Strips non-digit characters (spaces, dashes, leading zeros handled by Number()).
 * Returns NaN if no digits found.
 */
function parseTicketNumber(value) {
  if (value == null) return NaN;
  const digits = String(value).replace(/[^0-9]/g, '');
  return digits.length > 0 ? Number(digits) : NaN;
}

function normalizeCommodity(value) {
  if (!value) return null;
  const lower = value.toLowerCase().trim();
  return GRADE_TO_COMMODITY[lower] || lower;
}

/**
 * Score a settlement line against a delivery ticket on OPERATIONAL data only.
 * Ticket number matching is handled deterministically before this runs —
 * this function is only called for lines that didn't match by ticket number.
 *
 * Dimensions: weight (40%), date (30%), commodity (15%), contract (15%).
 */
function computeMatchScore(line, ticket, contractNumber) {
  const dimensions = {};
  const issues = [];
  let totalWeight = 0;
  let matchedWeight = 0;

  // 1. Weight match (40%) — strongest operational signal
  const weightDimWeight = 0.4;
  totalWeight += weightDimWeight;
  // Compare settlement gross_weight_mt (pre-dockage) against ticket net_weight_mt
  const lineWeight = line.gross_weight_mt || line.net_weight_mt;
  const ticketWeight = ticket.net_weight_mt;
  if (lineWeight && ticketWeight) {
    const diff = Math.abs(lineWeight - ticketWeight);
    const pctDiff = diff / Math.max(lineWeight, ticketWeight);
    if (pctDiff <= WEIGHT_TOLERANCE_PCT) {
      dimensions.weight = { matched: true, score: 1, diff_pct: pctDiff * 100 };
      matchedWeight += weightDimWeight;
    } else if (pctDiff <= 0.08) {
      const partialScore = 1 - ((pctDiff - WEIGHT_TOLERANCE_PCT) / 0.05);
      dimensions.weight = { matched: false, score: Math.max(0, partialScore), diff_pct: pctDiff * 100 };
      matchedWeight += weightDimWeight * Math.max(0, partialScore);
      issues.push(`weight_diff_${(pctDiff * 100).toFixed(1)}%`);
    } else {
      dimensions.weight = { matched: false, score: 0, diff_pct: pctDiff * 100 };
      issues.push('weight_mismatch');
    }
  } else {
    dimensions.weight = { matched: false, score: 0 };
    issues.push('weight_missing');
  }

  // 2. Date proximity (30%)
  const dateDimWeight = 0.3;
  totalWeight += dateDimWeight;
  if (line.delivery_date && ticket.delivery_date) {
    const lineDate = new Date(line.delivery_date);
    const ticketDate = new Date(ticket.delivery_date);
    const daysDiff = Math.abs((lineDate - ticketDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 1) {
      dimensions.date = { matched: true, score: 1, days_diff: daysDiff };
      matchedWeight += dateDimWeight;
    } else if (daysDiff <= DATE_TOLERANCE_DAYS) {
      const score = 1 - ((daysDiff - 1) / (DATE_TOLERANCE_DAYS - 1)) * 0.5;
      dimensions.date = { matched: true, score, days_diff: daysDiff };
      matchedWeight += dateDimWeight * score;
    } else {
      dimensions.date = { matched: false, score: 0, days_diff: daysDiff };
      issues.push('date_mismatch');
    }
  } else {
    dimensions.date = { matched: false, score: 0 };
    issues.push('date_missing');
  }

  // 3. Commodity match (15%)
  const commodityDimWeight = 0.15;
  totalWeight += commodityDimWeight;
  if (line.commodity && ticket.commodity) {
    const lineComm = normalizeCommodity(line.commodity);
    const ticketComm = normalizeCommodity(ticket.commodity.name);
    if (lineComm && ticketComm && (lineComm === ticketComm || lineComm.includes(ticketComm) || ticketComm.includes(lineComm))) {
      dimensions.commodity = { matched: true, score: 1 };
      matchedWeight += commodityDimWeight;
    } else {
      dimensions.commodity = { matched: false, score: 0 };
      issues.push('commodity_mismatch');
    }
  } else {
    dimensions.commodity = { matched: false, score: 0.3 };
    matchedWeight += commodityDimWeight * 0.3;
  }

  // 4. Contract match (15%)
  const contractDimWeight = 0.15;
  totalWeight += contractDimWeight;
  if (contractNumber && ticket.marketing_contract?.contract_number === contractNumber) {
    dimensions.contract = { matched: true, score: 1 };
    matchedWeight += contractDimWeight;
  } else if (ticket.marketing_contract_id) {
    dimensions.contract = { matched: false, score: 0 };
    issues.push('contract_mismatch');
  } else {
    dimensions.contract = { matched: false, score: 0.2 };
    matchedWeight += contractDimWeight * 0.2;
  }

  const score = totalWeight > 0 ? matchedWeight / totalWeight : 0;

  return { score: Math.round(score * 1000) / 1000, dimensions, issues };
}

/**
 * Reconcile a settlement's lines against delivery tickets.
 *
 * Algorithm:
 * 1. Fetch all unmatched settlement lines for the settlement
 * 2. Fetch candidate tickets (same farm, relevant contract/commodity/date range)
 * 3. For each line, score all candidate tickets
 * 4. Assign best match (greedy, highest score first) avoiding double-matching
 * 5. Return match results with confidence scores and exceptions
 */
export async function reconcileSettlement(settlementId) {
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`[RECON] Starting reconciliation for settlement ${settlementId}`);
  console.log(`${'═'.repeat(70)}`);

  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: {
      lines: { orderBy: { line_number: 'asc' } },
      marketing_contract: true,
      counterparty: true,
    },
  });

  if (!settlement) throw new Error('Settlement not found');
  console.log(`[RECON] Settlement #${settlement.settlement_number} | ${settlement.counterparty?.name || 'Unknown'} | ${settlement.lines.length} lines`);

  const farmId = settlement.farm_id;
  const contractNumber = settlement.marketing_contract?.contract_number;

  // Build date range for candidate tickets (expand ± 30 days around settlement lines)
  const lineDates = settlement.lines
    .filter(l => l.delivery_date)
    .map(l => new Date(l.delivery_date).getTime());
  const minDate = lineDates.length > 0
    ? new Date(Math.min(...lineDates) - 30 * 24 * 60 * 60 * 1000)
    : new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const maxDate = lineDates.length > 0
    ? new Date(Math.max(...lineDates) + 30 * 24 * 60 * 60 * 1000)
    : new Date();

  // Fetch candidate tickets
  const ticketWhere = {
    farm_id: farmId,
    delivery_date: { gte: minDate, lte: maxDate },
  };

  // Narrow by contract if known
  if (settlement.marketing_contract_id) {
    ticketWhere.marketing_contract_id = settlement.marketing_contract_id;
  } else if (settlement.counterparty_id) {
    ticketWhere.counterparty_id = settlement.counterparty_id;
  }

  // Phase 1: Numeric ticket-number matching (deterministic)
  // Parse both sides to numbers and subtract — if result is 0, it's a match.
  // This handles formatting differences (leading zeros, spaces, dashes) between
  // the CSV-imported ticket numbers and the settlement PDF-extracted values.
  const linesWithTicketNums = settlement.lines
    .filter(l => l.ticket_number_on_settlement)
    .map(l => ({
      line: l,
      raw: l.ticket_number_on_settlement.trim(),
      numeric: parseTicketNumber(l.ticket_number_on_settlement),
    }))
    .filter(l => !isNaN(l.numeric));

  // Fetch all farm tickets in the date window for numeric comparison
  let directMatchTickets = [];
  const ticketByNumber = new Map(); // numeric value → ticket
  if (linesWithTicketNums.length > 0) {
    const allFarmTickets = await prisma.deliveryTicket.findMany({
      where: {
        farm_id: farmId,
        delivery_date: { gte: minDate, lte: maxDate },
      },
      include: {
        marketing_contract: true,
        commodity: true,
        location: true,
      },
    });

    // Build numeric ticket number → ticket map
    for (const t of allFarmTickets) {
      const num = parseTicketNumber(t.ticket_number);
      if (!isNaN(num)) {
        ticketByNumber.set(num, t);
      }
    }

    // Match: parse both to numbers, subtract, if 0 → match
    for (const { numeric } of linesWithTicketNums) {
      const ticket = ticketByNumber.get(numeric);
      if (ticket && !directMatchTickets.some(t => t.id === ticket.id)) {
        directMatchTickets.push(ticket);
      }
    }
  }

  console.log(`[RECON] Phase 1: ${linesWithTicketNums.length} lines have ticket numbers → found ${directMatchTickets.length} matching tickets in DB (numeric comparison)`);
  if (directMatchTickets.length < linesWithTicketNums.length) {
    const foundNums = new Set(directMatchTickets.map(t => parseTicketNumber(t.ticket_number)));
    const missing = linesWithTicketNums.filter(l => !foundNums.has(l.numeric));
    console.log(`[RECON]   Missing ticket numbers: ${missing.map(l => l.raw).join(', ')}`);
  }

  // Phase 2: Fetch additional candidate tickets for lines without ticket-number matches
  const candidateTickets = await prisma.deliveryTicket.findMany({
    where: {
      ...ticketWhere,
      id: { notIn: directMatchTickets.map(t => t.id) },
    },
    include: {
      marketing_contract: true,
      commodity: true,
      location: true,
    },
  });

  // Also fetch tickets without contract/counterparty filter as fallback
  const alreadyFetched = new Set([...directMatchTickets.map(t => t.id), ...candidateTickets.map(t => t.id)]);
  let fallbackTickets = [];
  const unmatchableLines = settlement.lines.filter(l => {
    if (!l.ticket_number_on_settlement) return true;
    const num = parseTicketNumber(l.ticket_number_on_settlement);
    return isNaN(num) || !ticketByNumber.has(num);
  });
  if (unmatchableLines.length > candidateTickets.length) {
    fallbackTickets = await prisma.deliveryTicket.findMany({
      where: {
        farm_id: farmId,
        delivery_date: { gte: minDate, lte: maxDate },
        id: { notIn: [...alreadyFetched] },
      },
      include: {
        marketing_contract: true,
        commodity: true,
        location: true,
      },
    });
  }

  const allTickets = [...directMatchTickets, ...candidateTickets, ...fallbackTickets];
  console.log(`[RECON] Phase 2: ${candidateTickets.length} contract-filtered candidates + ${fallbackTickets.length} fallback = ${allTickets.length} total tickets`);

  // Phase 3: Deterministic matches first — lock in ticket-number matches before greedy
  // This prevents the greedy algorithm from stealing tickets that have exact # matches.
  const matchedLineIds = new Set();
  const matchedTicketIds = new Set();
  const matches = [];

  for (const line of settlement.lines) {
    const lineNum = line.ticket_number_on_settlement?.trim();
    if (!lineNum) continue;
    const numericValue = parseTicketNumber(lineNum);
    if (isNaN(numericValue)) continue;
    const ticket = ticketByNumber.get(numericValue);
    if (!ticket) continue;

    // Allow split-load: multiple settlement lines can match the same ticket
    // when they share the same ticket number (e.g. one truck load split across
    // two contracts). Only block re-use when ticket numbers differ.
    if (matchedTicketIds.has(ticket.id)) {
      // Check if the ticket was already matched to a line with the SAME ticket number
      const priorMatch = matches.find(m => m.ticket_id === ticket.id);
      const priorLine = priorMatch && settlement.lines.find(l => l.id === priorMatch.line_id);
      const priorNum = priorLine?.ticket_number_on_settlement?.trim();
      if (priorNum !== lineNum) continue; // different ticket # tried to reuse — block it
      // Same ticket number = split-load, allow through
    }

    const result = computeMatchScore(line, ticket, contractNumber);

    matchedLineIds.add(line.id);
    matchedTicketIds.add(ticket.id);
    matches.push({
      line_id: line.id,
      ticket_id: ticket.id,
      score: result.score,
      match_status: 'matched',
      exception_reason: null,
      dimensions: result.dimensions,
      issues: result.issues,
    });
    const splitTag = matches.filter(m => m.ticket_id === ticket.id).length > 1 ? ' [split-load]' : '';
    console.log(`[RECON]   ✓ Line ${line.line_number} (tkt# ${lineNum}) → Ticket ${ticket.ticket_number} [deterministic]${splitTag} score=${result.score.toFixed(3)}`);
  }

  console.log(`[RECON] Phase 3: ${matches.length} deterministic ticket-number matches`);

  // Phase 3b: Lines that HAVE a ticket number but Phase 1/3 couldn't find a match
  // must NOT fall through to scored matching — flag them as exceptions immediately.
  // Scored matching would pair them with a wrong ticket based on weight/date similarity.
  for (const line of settlement.lines) {
    if (matchedLineIds.has(line.id)) continue;
    const lineNum = line.ticket_number_on_settlement?.trim();
    if (!lineNum) continue;
    const numericValue = parseTicketNumber(lineNum);
    if (isNaN(numericValue)) continue;
    // This line has a valid ticket number but no delivery ticket matched it
    matchedLineIds.add(line.id);
    matches.push({
      line_id: line.id,
      ticket_id: null,
      score: 0,
      match_status: 'exception',
      exception_reason: `ticket_not_found: ${lineNum}`,
      dimensions: {},
      issues: [`ticket_number_${lineNum}_not_in_system`],
    });
    console.log(`[RECON]   ✗ Line ${line.line_number} (tkt# ${lineNum}) → EXCEPTION — ticket number not found in delivery tickets`);
  }

  // Phase 4: Score remaining (non-deterministic) line-ticket combinations
  // Only lines WITHOUT a ticket number reach this phase.
  const remainingLines = settlement.lines.filter(l => !matchedLineIds.has(l.id));
  const remainingTickets = allTickets.filter(t => !matchedTicketIds.has(t.id));

  const scoredPairs = [];
  for (const line of remainingLines) {
    for (const ticket of remainingTickets) {
      const result = computeMatchScore(line, ticket, contractNumber);
      scoredPairs.push({
        line_id: line.id,
        ticket_id: ticket.id,
        ...result,
      });
    }
  }

  // Sort by score descending (greedy assignment)
  scoredPairs.sort((a, b) => b.score - a.score);

  // Greedy assignment for remaining lines
  for (const pair of scoredPairs) {
    if (matchedLineIds.has(pair.line_id) || matchedTicketIds.has(pair.ticket_id)) continue;
    if (pair.score < 0.3) continue; // minimum threshold

    matchedLineIds.add(pair.line_id);
    matchedTicketIds.add(pair.ticket_id);

    let matchStatus = 'matched';
    let exceptionReason = null;

    if (pair.score < 0.6) {
      matchStatus = 'exception';
      exceptionReason = pair.issues.join(', ') || 'low_confidence';
    }

    const lineInfo = settlement.lines.find(l => l.id === pair.line_id);
    const ticketInfo = allTickets.find(t => t.id === pair.ticket_id);
    matches.push({
      line_id: pair.line_id,
      ticket_id: pair.ticket_id,
      score: pair.score,
      match_status: matchStatus,
      exception_reason: exceptionReason,
      dimensions: pair.dimensions,
      issues: pair.issues,
    });
    console.log(`[RECON]   ${matchStatus === 'matched' ? '✓' : '⚠'} Line ${lineInfo?.line_number} → Ticket ${ticketInfo?.ticket_number} [scored] score=${pair.score.toFixed(3)} status=${matchStatus}${exceptionReason ? ` reason=${exceptionReason}` : ''}`);
  }

  // Handle unmatched lines
  const unmatchedLines = settlement.lines.filter(l => !matchedLineIds.has(l.id));
  for (const line of unmatchedLines) {
    matches.push({
      line_id: line.id,
      ticket_id: null,
      score: 0,
      match_status: 'exception',
      exception_reason: 'missing_ticket',
      dimensions: {},
      issues: ['no_matching_ticket_found'],
    });
    console.log(`[RECON]   ✗ Line ${line.line_number} (tkt# ${line.ticket_number_on_settlement || 'none'}) → UNMATCHED — no ticket found`);
  }

  // Save match results to database
  for (const match of matches) {
    await prisma.settlementLine.update({
      where: { id: match.line_id },
      data: {
        delivery_ticket_id: match.ticket_id,
        match_status: match.match_status,
        match_confidence: match.score,
        exception_reason: match.exception_reason,
      },
    });
  }

  // Update settlement status
  const allMatched = matches.every(m => m.match_status === 'matched');
  const hasExceptions = matches.some(m => m.match_status === 'exception');
  const newStatus = allMatched ? 'reconciled' : hasExceptions ? 'disputed' : 'pending';

  await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: newStatus },
  });

  const summary = {
    total_lines: settlement.lines.length,
    matched: matches.filter(m => m.match_status === 'matched').length,
    exceptions: matches.filter(m => m.match_status === 'exception').length,
    unmatched: unmatchedLines.length,
    candidate_tickets: allTickets.length,
    avg_confidence: matches.length > 0
      ? matches.reduce((s, m) => s + m.score, 0) / matches.length
      : 0,
  };

  console.log(`[RECON] ${'─'.repeat(50)}`);
  console.log(`[RECON] RESULT: ${summary.matched} matched | ${summary.exceptions} exceptions | ${summary.unmatched} unmatched | avg conf ${(summary.avg_confidence * 100).toFixed(0)}%`);
  console.log(`[RECON] Status: ${newStatus}`);
  console.log(`${'═'.repeat(70)}\n`);

  return {
    settlement_id: settlementId,
    status: newStatus,
    matches,
    summary,
  };
}

/**
 * Manually match a settlement line to a delivery ticket.
 */
export async function manualMatch(lineId, ticketId, notes = null) {
  const line = await prisma.settlementLine.update({
    where: { id: lineId },
    data: {
      delivery_ticket_id: ticketId,
      match_status: 'manual',
      match_confidence: 1.0,
      exception_reason: notes ? `Manual: ${notes}` : 'Manual match',
    },
  });
  return line;
}

/**
 * Approve all matches for a settlement, setting status to "approved".
 * Creates Delivery records, updates MarketingContracts, generates CashFlowEntry receipts,
 * and stores a reconciliation report.
 */
export async function approveSettlement(settlementId, userId = null) {
  console.log(`\n[APPROVE] Starting approval for settlement ${settlementId} by user ${userId}`);

  // Verify all lines are matched or manually resolved
  const lines = await prisma.settlementLine.findMany({
    where: { settlement_id: settlementId },
    include: {
      delivery_ticket: {
        include: { marketing_contract: true },
      },
    },
  });

  const unresolved = lines.filter(l =>
    l.match_status === 'unmatched' || l.match_status === 'exception'
  );

  if (unresolved.length > 0) {
    throw new Error(
      `Cannot approve: ${unresolved.length} line(s) still have unresolved exceptions`
    );
  }

  // Fetch settlement for farm_id, total_amount, date
  const settlementData = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: { marketing_contract: true },
  });
  if (!settlementData) throw new Error('Settlement not found');

  const farmId = settlementData.farm_id;

  // Run all approval side effects in a transaction
  const result = await prisma.$transaction(async (tx) => {
    // 1. Mark matched tickets as settled
    const ticketIds = lines
      .filter(l => l.delivery_ticket_id)
      .map(l => l.delivery_ticket_id);

    if (ticketIds.length > 0) {
      await tx.deliveryTicket.updateMany({
        where: { id: { in: ticketIds } },
        data: { settled: true },
      });
    }

    // 2. Create Delivery records for matched lines with marketing contracts
    let deliveriesCreated = 0;
    const contractDeliveryMap = new Map(); // contractId → total MT delivered from this settlement

    for (const line of lines) {
      const ticket = line.delivery_ticket;
      if (!ticket?.marketing_contract_id) continue;

      // Prevent double-counting: skip if Delivery already exists for this ticket + contract
      const existing = await tx.delivery.findFirst({
        where: {
          marketing_contract_id: ticket.marketing_contract_id,
          ticket_number: ticket.ticket_number,
          farm_id: farmId,
        },
      });
      if (existing) continue;

      const mtDelivered = line.net_weight_mt || ticket.net_weight_mt;
      await tx.delivery.create({
        data: {
          farm_id: farmId,
          marketing_contract_id: ticket.marketing_contract_id,
          mt_delivered: mtDelivered,
          delivery_date: ticket.delivery_date,
          ticket_number: ticket.ticket_number,
          notes: 'Auto-created from settlement approval',
        },
      });
      deliveriesCreated++;

      // Track per-contract MT for cash flow split
      const prev = contractDeliveryMap.get(ticket.marketing_contract_id) || 0;
      contractDeliveryMap.set(ticket.marketing_contract_id, prev + mtDelivered);
    }

    // 3. Update MarketingContracts — re-aggregate ALL deliveries per contract
    const contractsUpdated = [];
    for (const contractId of contractDeliveryMap.keys()) {
      const agg = await tx.delivery.aggregate({
        where: { marketing_contract_id: contractId },
        _sum: { mt_delivered: true },
      });
      const totalDelivered = agg._sum.mt_delivered || 0;

      const contract = await tx.marketingContract.findUnique({
        where: { id: contractId },
      });
      if (!contract) continue;

      const rawRemaining = contract.contracted_mt - totalDelivered;
      const remaining = rawRemaining < 0.5 ? 0 : rawRemaining; // tolerance for floating-point dust

      // Auto-transition status
      let newStatus = contract.status;
      if (totalDelivered > 0 && contract.status === 'executed') {
        newStatus = 'in_delivery';
      }
      if (remaining <= 0 && (contract.status === 'executed' || contract.status === 'in_delivery')) {
        newStatus = 'delivered';
      }

      await tx.marketingContract.update({
        where: { id: contractId },
        data: {
          delivered_mt: totalDelivered,
          remaining_mt: remaining,
          status: newStatus,
        },
      });

      contractsUpdated.push({
        contract_id: contractId,
        contract_number: contract.contract_number,
        delivered_mt: totalDelivered,
        remaining_mt: remaining,
        previous_status: contract.status,
        new_status: newStatus,
      });
    }

    // 4. Create CashFlowEntry receipts
    let cashFlowEntriesCreated = 0;
    let cashFlowTotal = 0;

    if (settlementData.total_amount && settlementData.total_amount > 0 && contractDeliveryMap.size > 0) {
      const periodDate = settlementData.settlement_date || new Date();
      const totalMtFromSettlement = Array.from(contractDeliveryMap.values()).reduce((a, b) => a + b, 0);

      for (const [contractId, mt] of contractDeliveryMap) {
        // Split proportionally by MT delivered per contract
        const proportion = totalMtFromSettlement > 0 ? mt / totalMtFromSettlement : 1 / contractDeliveryMap.size;
        const amount = Math.round(settlementData.total_amount * proportion * 100) / 100;

        const contractInfo = contractsUpdated.find(c => c.contract_id === contractId);
        await tx.cashFlowEntry.create({
          data: {
            farm_id: farmId,
            period_date: periodDate,
            entry_type: 'receipt',
            category: 'grain_sale',
            description: `Settlement #${settlementData.settlement_number} — ${contractInfo?.contract_number || 'contract'}`,
            amount: amount,
            marketing_contract_id: contractId,
            is_actual: true,
            notes: `Auto-created from settlement approval`,
          },
        });
        cashFlowEntriesCreated++;
        cashFlowTotal += amount;
      }
    }

    // 5. Build reconciliation report
    const report = {
      approved_by: userId,
      approved_at: new Date().toISOString(),
      total_lines: lines.length,
      matched_lines: lines.filter(l => l.match_status === 'matched').length,
      manual_lines: lines.filter(l => l.match_status === 'manual').length,
      total_settlement_value: settlementData.total_amount || 0,
      deliveries_created: deliveriesCreated,
      contracts_updated: contractsUpdated,
      cash_flow_entries_created: cashFlowEntriesCreated,
      cash_flow_total: cashFlowTotal,
    };

    // 6. Save report and set status
    const settlement = await tx.settlement.update({
      where: { id: settlementId },
      data: {
        status: 'approved',
        reconciliation_report: report,
      },
      include: {
        lines: {
          include: { delivery_ticket: true },
          orderBy: { line_number: 'asc' },
        },
        counterparty: true,
        marketing_contract: true,
      },
    });

    console.log(`[APPROVE] Report: ${JSON.stringify(report, null, 2)}`);
    return { settlement, report, contracts_updated: contractsUpdated };
  });

  console.log(`[APPROVE] Settlement approved successfully`);
  return result;
}
