import prisma from '../config/database.js';
import { recalculateContract } from './marketingService.js';

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
const DATE_TOLERANCE_DAYS = 2;     // ±2 days — with CST timestamps dates should be exact or ±1

// Weight/date mode — tighter tolerances, no ticket-number matching
// Used for three-party deliveries (e.g. GSL buys, delivers to JK Milling)
// where the buyer's settlement references their own ticket numbers, not the delivery site's.
const WD_WEIGHT_TOLERANCE_PCT = 0.015; // 1.5% — tighter when matching solely on weight
const WD_DATE_TOLERANCE_DAYS = 2;      // ±2 days

/**
 * Convert a UTC timestamp to CST (Saskatchewan, always UTC-6, no DST) date string.
 * Returns YYYY-MM-DD in CST. Used to get the true local delivery date from source_timestamp.
 */
function utcToCstDate(utcDate) {
  if (!utcDate) return null;
  const d = new Date(utcDate);
  // Subtract 6 hours for CST
  d.setUTCHours(d.getUTCHours() - 6);
  return d.toISOString().split('T')[0];
}

/**
 * Get the best delivery date for a ticket, preferring source_timestamp (converted to CST).
 * source_timestamp is the exact Traction Ag timestamp; delivery_date may have timezone artifacts.
 */
function getTicketCstDate(ticket) {
  if (ticket.source_timestamp) {
    return new Date(utcToCstDate(ticket.source_timestamp) + 'T12:00:00Z');
  }
  return ticket.delivery_date ? new Date(ticket.delivery_date) : null;
}

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
 * Extract the base grain type from a commodity name for comparison.
 * "Wheat (Milling) / Blé (Meunier)" → "wheat"
 * "Spring Wheat" → "wheat"
 * "1 CWRS" → "wheat" (via GRADE_TO_COMMODITY)
 * "Canola" → "canola"
 */
const BASE_GRAIN_MAP = {
  wheat: 'wheat', 'spring wheat': 'wheat', 'winter wheat': 'wheat', 'durum wheat': 'wheat',
  'hard red spring': 'wheat', 'cwrs': 'wheat', 'wheat (milling)': 'wheat',
  canola: 'canola', rapeseed: 'canola',
  durum: 'durum', cwad: 'durum',
  lentils: 'lentils', 'red lentils': 'lentils', 'green lentils': 'lentils',
  chickpeas: 'chickpeas', 'kabuli chickpeas': 'chickpeas', 'desi chickpeas': 'chickpeas',
  peas: 'peas', 'yellow peas': 'peas', 'green peas': 'peas',
  barley: 'barley', 'feed barley': 'barley', 'malt barley': 'barley',
  oats: 'oats', flax: 'flax', mustard: 'mustard',
};

function getBaseGrain(value) {
  if (!value) return null;
  const normalized = normalizeCommodity(value);
  if (!normalized) return null;
  // Direct lookup
  if (BASE_GRAIN_MAP[normalized]) return BASE_GRAIN_MAP[normalized];
  // Check if any key is contained in the normalized value
  for (const [key, base] of Object.entries(BASE_GRAIN_MAP)) {
    if (normalized.includes(key)) return base;
  }
  return normalized;
}

function commoditiesMatch(a, b) {
  const baseA = getBaseGrain(a);
  const baseB = getBaseGrain(b);
  if (!baseA || !baseB) return false;
  return baseA === baseB;
}

/**
 * Score a settlement line against a delivery ticket on OPERATIONAL data only.
 * Ticket number matching is handled deterministically before this runs —
 * this function is only called for lines that didn't match by ticket number.
 *
 * Default mode — Dimensions: weight (40%), date (30%), commodity (15%), contract (15%).
 * Weight/date mode — Dimensions: weight (55%), date (45%). Used for three-party
 * deliveries where buyer's ticket numbers don't match delivery site tickets.
 */
function computeMatchScore(line, ticket, contractNumber, { weightDateMode = false } = {}) {
  const dimensions = {};
  const issues = [];
  let totalWeight = 0;
  let matchedWeight = 0;

  const weightTolerance = weightDateMode ? WD_WEIGHT_TOLERANCE_PCT : WEIGHT_TOLERANCE_PCT;
  const dateTolerance = weightDateMode ? WD_DATE_TOLERANCE_DAYS : DATE_TOLERANCE_DAYS;

  // 1. Weight match — strongest operational signal
  const weightDimWeight = weightDateMode ? 0.55 : 0.4;
  totalWeight += weightDimWeight;
  // Compare settlement net_weight_mt against ticket net_weight_mt.
  // Prefer net: GSL gross includes vehicle weight (63 MT truck vs 43 MT grain).
  // For other buyers, gross is pre-dockage and close to net — still a reasonable fallback.
  const lineWeight = line.net_weight_mt || line.gross_weight_mt;
  const ticketWeight = ticket.net_weight_mt;
  if (lineWeight && ticketWeight) {
    const diff = Math.abs(lineWeight - ticketWeight);
    const pctDiff = diff / Math.max(lineWeight, ticketWeight);
    if (pctDiff <= weightTolerance) {
      dimensions.weight = { matched: true, score: 1, diff_pct: pctDiff * 100 };
      matchedWeight += weightDimWeight;
    } else if (pctDiff <= 0.08) {
      const partialScore = 1 - ((pctDiff - weightTolerance) / (0.08 - weightTolerance));
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

  // 2. Date proximity — use source_timestamp (CST) when available for accurate comparison
  const dateDimWeight = weightDateMode ? 0.45 : 0.3;
  totalWeight += dateDimWeight;
  const ticketDate = getTicketCstDate(ticket);
  if (line.delivery_date && ticketDate) {
    const lineDate = new Date(line.delivery_date);
    const daysDiff = Math.abs((lineDate - ticketDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 1) {
      dimensions.date = { matched: true, score: 1, days_diff: daysDiff };
      matchedWeight += dateDimWeight;
    } else if (daysDiff <= dateTolerance) {
      const score = 1 - ((daysDiff - 1) / (dateTolerance - 1)) * 0.5;
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

  // 3. Commodity match — skip in weight/date mode (buyer settlement commodity naming is unreliable)
  if (!weightDateMode) {
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

    // 4. Contract match — skip in weight/date mode
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
export async function reconcileSettlement(settlementId, { matchMode = 'auto' } = {}) {
  const weightDateMode = matchMode === 'weight_date';
  console.log(`\n${'═'.repeat(70)}`);
  console.log(`[RECON] Starting reconciliation for settlement ${settlementId} [mode=${matchMode}]`);
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

  // ═══ PHASE 1–3: Ticket-number matching (skipped in weight_date mode) ═══
  const matchedLineIds = new Set();
  const matchedTicketIds = new Set();
  const matches = [];
  let directMatchTickets = [];
  const ticketByNumber = new Map();

  if (!weightDateMode) {
    // Phase 1: Numeric ticket-number matching (deterministic)
    const linesWithTicketNums = settlement.lines
      .filter(l => l.ticket_number_on_settlement)
      .map(l => ({
        line: l,
        raw: l.ticket_number_on_settlement.trim(),
        numeric: parseTicketNumber(l.ticket_number_on_settlement),
      }))
      .filter(l => !isNaN(l.numeric));

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

      for (const t of allFarmTickets) {
        const num = parseTicketNumber(t.ticket_number);
        if (!isNaN(num)) {
          ticketByNumber.set(num, t);
        }
      }

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
  } else {
    console.log(`[RECON] Phase 1: SKIPPED (weight/date mode — three-party delivery)`);
  }

  // Phase 2: Fetch candidate tickets
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

  const alreadyFetched = new Set([...directMatchTickets.map(t => t.id), ...candidateTickets.map(t => t.id)]);
  let fallbackTickets = [];
  if (weightDateMode) {
    // In weight/date mode, always fetch the full ticket pool — no ticket-number filtering
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
  } else {
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
  }

  const allTickets = [...directMatchTickets, ...candidateTickets, ...fallbackTickets];
  console.log(`[RECON] Phase 2: ${candidateTickets.length} contract-filtered candidates + ${fallbackTickets.length} fallback = ${allTickets.length} total tickets`);

  // Phase 3: Deterministic matches (skipped in weight_date mode)
  if (!weightDateMode) {
    for (const line of settlement.lines) {
      const lineNum = line.ticket_number_on_settlement?.trim();
      if (!lineNum) continue;
      const numericValue = parseTicketNumber(lineNum);
      if (isNaN(numericValue)) continue;
      const ticket = ticketByNumber.get(numericValue);
      if (!ticket) continue;

      if (matchedTicketIds.has(ticket.id)) {
        const priorMatch = matches.find(m => m.ticket_id === ticket.id);
        const priorLine = priorMatch && settlement.lines.find(l => l.id === priorMatch.line_id);
        const priorNum = priorLine?.ticket_number_on_settlement?.trim();
        if (priorNum !== lineNum) continue;
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

    // Phase 3b: Lines with ticket numbers that didn't match → exception (not in weight_date mode)
    for (const line of settlement.lines) {
      if (matchedLineIds.has(line.id)) continue;
      const lineNum = line.ticket_number_on_settlement?.trim();
      if (!lineNum) continue;
      const numericValue = parseTicketNumber(lineNum);
      if (isNaN(numericValue)) continue;
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
  } else {
    console.log(`[RECON] Phase 3: SKIPPED (weight/date mode)`);
  }

  // Phase 4: Score ALL remaining line-ticket combinations
  // In weight_date mode, ALL lines reach this phase (no deterministic matching).
  // In auto mode, only lines WITHOUT ticket numbers reach this phase.
  const remainingLines = settlement.lines.filter(l => !matchedLineIds.has(l.id));
  let remainingTickets = allTickets.filter(t => !matchedTicketIds.has(t.id));

  // In weight/date mode, pre-filter tickets by counterparty and commodity to avoid
  // grabbing random tickets with similar weight from unrelated buyers/crops.
  if (weightDateMode && remainingTickets.length > 0) {
    const settlementCommodity = normalizeCommodity(
      settlement.lines[0]?.commodity || settlement.marketing_contract?.commodity?.name
    );
    const counterpartyId = settlement.counterparty_id;
    const contractId = settlement.marketing_contract_id;

    let filtered = remainingTickets;

    // Filter by contract first (tightest), then counterparty, then commodity
    if (contractId) {
      const byContract = filtered.filter(t => t.marketing_contract_id === contractId);
      if (byContract.length > 0) filtered = byContract;
    } else if (counterpartyId) {
      const byCounterparty = filtered.filter(t => t.counterparty_id === counterpartyId);
      if (byCounterparty.length > 0) filtered = byCounterparty;
    }

    // Hard filter by commodity — never match across grain types (e.g. Canola ≠ Wheat)
    if (settlementCommodity) {
      const byCommodity = filtered.filter(t => commoditiesMatch(t.commodity?.name, settlementCommodity));
      if (byCommodity.length > 0) {
        filtered = byCommodity;
      } else {
        console.log(`[RECON]   WARNING: No tickets match commodity "${settlementCommodity}" — weight/date matching may fail`);
      }
    }

    console.log(`[RECON] Phase 4: Weight/date pre-filter: ${remainingTickets.length} → ${filtered.length} tickets (contract=${!!contractId}, counterparty=${!!counterpartyId}, commodity=${settlementCommodity || 'unknown'})`);
    remainingTickets = filtered;
  }

  console.log(`[RECON] Phase 4: Scoring ${remainingLines.length} lines × ${remainingTickets.length} tickets [mode=${matchMode}]`);

  const scoredPairs = [];
  for (const line of remainingLines) {
    for (const ticket of remainingTickets) {
      const result = computeMatchScore(line, ticket, contractNumber, { weightDateMode });
      scoredPairs.push({
        line_id: line.id,
        ticket_id: ticket.id,
        ...result,
      });
    }
  }

  // Sort by score descending; break ties by date proximity (closest date wins)
  scoredPairs.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    // Tiebreaker: prefer closer date match
    const aDays = a.dimensions?.date?.days_diff ?? 999;
    const bDays = b.dimensions?.date?.days_diff ?? 999;
    return aDays - bDays;
  });

  // Greedy assignment — in weight_date mode use a higher minimum threshold (0.5)
  // because we're relying entirely on weight+date with no ticket number confirmation
  const minThreshold = weightDateMode ? 0.5 : 0.3;
  const exceptionThreshold = weightDateMode ? 0.7 : 0.6;

  for (const pair of scoredPairs) {
    if (matchedLineIds.has(pair.line_id) || matchedTicketIds.has(pair.ticket_id)) continue;
    if (pair.score < minThreshold) continue;

    matchedLineIds.add(pair.line_id);
    matchedTicketIds.add(pair.ticket_id);

    const lineInfo = settlement.lines.find(l => l.id === pair.line_id);
    const ticketInfo = allTickets.find(t => t.id === pair.ticket_id);

    let matchStatus = 'matched';
    let exceptionReason = null;

    if (pair.score < exceptionThreshold) {
      matchStatus = 'exception';
      exceptionReason = pair.issues.join(', ') || 'low_confidence';
    }

    // In weight/date mode: force exception if commodity doesn't match — admin must manually verify
    if (weightDateMode && lineInfo && ticketInfo) {
      const lineCommodity = lineInfo.commodity || settlement.marketing_contract?.commodity?.name;
      const ticketCommodity = ticketInfo.commodity?.name;
      if (lineCommodity && ticketCommodity && !commoditiesMatch(lineCommodity, ticketCommodity)) {
        matchStatus = 'exception';
        exceptionReason = `commodity_mismatch: settlement="${lineCommodity}" ticket="${ticketCommodity}"`;
      }
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
      // Use ticket's contract link, fall back to settlement's contract link
      const contractId = ticket?.marketing_contract_id || settlementData.marketing_contract_id;
      if (!contractId) continue;

      // Prevent double-counting: skip if Delivery already exists for this ticket + contract
      const ticketNum = ticket?.ticket_number || line.ticket_number_on_settlement;
      const existing = await tx.delivery.findFirst({
        where: {
          marketing_contract_id: contractId,
          ticket_number: ticketNum,
          farm_id: farmId,
        },
      });
      if (existing) continue;

      const mtDelivered = line.net_weight_mt || ticket?.net_weight_mt;
      if (!mtDelivered) continue;

      await tx.delivery.create({
        data: {
          farm_id: farmId,
          marketing_contract_id: contractId,
          mt_delivered: mtDelivered,
          delivery_date: ticket?.delivery_date || line.delivery_date,
          ticket_number: ticketNum,
          notes: 'Auto-created from settlement approval',
        },
      });
      deliveriesCreated++;

      // Track per-contract MT for cash flow split
      const prev = contractDeliveryMap.get(contractId) || 0;
      contractDeliveryMap.set(contractId, prev + mtDelivered);
    }

    // 3. Recalculate MarketingContracts using shared recalc function
    const contractsUpdated = [];
    for (const contractId of contractDeliveryMap.keys()) {
      const result = await recalculateContract(contractId, tx);
      if (result) contractsUpdated.push(result);
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
