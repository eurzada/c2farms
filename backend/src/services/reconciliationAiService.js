import prisma from '../config/database.js';

/**
 * AI-powered reconciliation service for matching settlement lines to delivery tickets.
 *
 * Since ticket numbers don't match across systems (Traction Ag, Cargill, Bunge, JGL
 * all use independent numbering), reconciliation uses multi-dimensional matching:
 *   1. Contract # (strongest signal)
 *   2. Net weight within tolerance (±2%)
 *   3. Date proximity (delivery date ± 3 days)
 *   4. Commodity match
 *   5. Location/origin hints
 */

const WEIGHT_TOLERANCE_PCT = 0.02; // 2% tolerance for weight matching
const DATE_TOLERANCE_DAYS = 3;     // ±3 days for date proximity

/**
 * Compute a match score between a settlement line and a delivery ticket.
 * Returns { score: 0-1, dimensions: {...}, issues: [] }
 */
function computeMatchScore(line, ticket, contractNumber) {
  const dimensions = {};
  const issues = [];
  let totalWeight = 0;
  let matchedWeight = 0;

  // 1. Contract match (weight: 40%)
  const contractWeight = 0.4;
  totalWeight += contractWeight;
  if (contractNumber && ticket.marketing_contract?.contract_number === contractNumber) {
    dimensions.contract = { matched: true, score: 1 };
    matchedWeight += contractWeight;
  } else if (ticket.marketing_contract_id) {
    dimensions.contract = { matched: false, score: 0 };
    issues.push('contract_mismatch');
  } else {
    dimensions.contract = { matched: false, score: 0.2 }; // unlinked ticket gets partial
    matchedWeight += contractWeight * 0.2;
  }

  // 2. Weight match (weight: 30%)
  const weightWeight = 0.3;
  totalWeight += weightWeight;
  if (line.net_weight_mt && ticket.net_weight_mt) {
    const diff = Math.abs(line.net_weight_mt - ticket.net_weight_mt);
    const pctDiff = diff / Math.max(line.net_weight_mt, ticket.net_weight_mt);
    if (pctDiff <= WEIGHT_TOLERANCE_PCT) {
      dimensions.weight = { matched: true, score: 1, diff_pct: pctDiff * 100 };
      matchedWeight += weightWeight;
    } else if (pctDiff <= 0.05) {
      const partialScore = 1 - ((pctDiff - WEIGHT_TOLERANCE_PCT) / 0.03);
      dimensions.weight = { matched: false, score: Math.max(0, partialScore), diff_pct: pctDiff * 100 };
      matchedWeight += weightWeight * Math.max(0, partialScore);
      issues.push(`weight_diff_${(pctDiff * 100).toFixed(1)}%`);
    } else {
      dimensions.weight = { matched: false, score: 0, diff_pct: pctDiff * 100 };
      issues.push('weight_mismatch');
    }
  } else {
    dimensions.weight = { matched: false, score: 0.1 }; // no data
    matchedWeight += weightWeight * 0.1;
  }

  // 3. Date proximity (weight: 20%)
  const dateWeight = 0.2;
  totalWeight += dateWeight;
  if (line.delivery_date && ticket.delivery_date) {
    const lineDate = new Date(line.delivery_date);
    const ticketDate = new Date(ticket.delivery_date);
    const daysDiff = Math.abs((lineDate - ticketDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 1) {
      dimensions.date = { matched: true, score: 1, days_diff: daysDiff };
      matchedWeight += dateWeight;
    } else if (daysDiff <= DATE_TOLERANCE_DAYS) {
      const score = 1 - ((daysDiff - 1) / (DATE_TOLERANCE_DAYS - 1)) * 0.5;
      dimensions.date = { matched: true, score, days_diff: daysDiff };
      matchedWeight += dateWeight * score;
    } else {
      dimensions.date = { matched: false, score: 0, days_diff: daysDiff };
      issues.push('date_mismatch');
    }
  } else {
    dimensions.date = { matched: false, score: 0.1 };
    matchedWeight += dateWeight * 0.1;
  }

  // 4. Commodity match (weight: 10%)
  const commodityWeight = 0.1;
  totalWeight += commodityWeight;
  if (line.commodity && ticket.commodity) {
    const lineComm = line.commodity.toLowerCase();
    const ticketComm = ticket.commodity.name.toLowerCase();
    if (lineComm === ticketComm || lineComm.includes(ticketComm) || ticketComm.includes(lineComm)) {
      dimensions.commodity = { matched: true, score: 1 };
      matchedWeight += commodityWeight;
    } else {
      dimensions.commodity = { matched: false, score: 0 };
      issues.push('commodity_mismatch');
    }
  } else {
    dimensions.commodity = { matched: false, score: 0.5 };
    matchedWeight += commodityWeight * 0.5;
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
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    include: {
      lines: { orderBy: { line_number: 'asc' } },
      marketing_contract: true,
      counterparty: true,
    },
  });

  if (!settlement) throw new Error('Settlement not found');

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

  const candidateTickets = await prisma.deliveryTicket.findMany({
    where: ticketWhere,
    include: {
      marketing_contract: true,
      commodity: true,
      location: true,
    },
  });

  // Also fetch tickets without contract/counterparty filter as fallback
  let fallbackTickets = [];
  if (candidateTickets.length < settlement.lines.length) {
    fallbackTickets = await prisma.deliveryTicket.findMany({
      where: {
        farm_id: farmId,
        delivery_date: { gte: minDate, lte: maxDate },
        id: { notIn: candidateTickets.map(t => t.id) },
      },
      include: {
        marketing_contract: true,
        commodity: true,
        location: true,
      },
    });
  }

  const allTickets = [...candidateTickets, ...fallbackTickets];

  // Score all line-ticket combinations
  const scoredPairs = [];
  for (const line of settlement.lines) {
    for (const ticket of allTickets) {
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

  // Greedy assignment: highest-scoring pairs first, no double-matching
  const matchedLineIds = new Set();
  const matchedTicketIds = new Set();
  const matches = [];

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

    matches.push({
      line_id: pair.line_id,
      ticket_id: pair.ticket_id,
      score: pair.score,
      match_status: matchStatus,
      exception_reason: exceptionReason,
      dimensions: pair.dimensions,
      issues: pair.issues,
    });
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

  return {
    settlement_id: settlementId,
    status: newStatus,
    matches,
    summary: {
      total_lines: settlement.lines.length,
      matched: matches.filter(m => m.match_status === 'matched').length,
      exceptions: matches.filter(m => m.match_status === 'exception').length,
      unmatched: unmatchedLines.length,
      candidate_tickets: allTickets.length,
      avg_confidence: matches.length > 0
        ? matches.reduce((s, m) => s + m.score, 0) / matches.length
        : 0,
    },
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
 */
export async function approveSettlement(settlementId) {
  // Verify all lines are matched or manually resolved
  const lines = await prisma.settlementLine.findMany({
    where: { settlement_id: settlementId },
  });

  const unresolved = lines.filter(l =>
    l.match_status === 'unmatched' || l.match_status === 'exception'
  );

  if (unresolved.length > 0) {
    throw new Error(
      `Cannot approve: ${unresolved.length} line(s) still have unresolved exceptions`
    );
  }

  // Mark matched tickets as settled
  const ticketIds = lines
    .filter(l => l.delivery_ticket_id)
    .map(l => l.delivery_ticket_id);

  if (ticketIds.length > 0) {
    await prisma.deliveryTicket.updateMany({
      where: { id: { in: ticketIds } },
      data: { settled: true },
    });
  }

  const settlement = await prisma.settlement.update({
    where: { id: settlementId },
    data: { status: 'approved' },
    include: {
      lines: {
        include: { delivery_ticket: true },
        orderBy: { line_number: 'asc' },
      },
      counterparty: true,
      marketing_contract: true,
    },
  });

  return settlement;
}
