import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { resolveInventoryFarm } from './resolveInventoryFarm.js';
import {
  createSettlementWithLines,
  applyGradePricing,
  finalizeSettlement,
  pushToLogistics,
} from './terminalSettlementService.js';

const logger = createLogger('lgx:transfer-recon');

// Commodity normalization map — maps various names/codes to a canonical key
const COMMODITY_ALIASES = {
  cwrs: 'wheat', 'spring wheat': 'wheat', wheat: 'wheat', 'red spring': 'wheat',
  cwad: 'durum', durum: 'durum',
  cnla: 'canola', canola: 'canola', nexera: 'canola', nxra: 'canola',
  brly: 'barley', barley: 'barley', 'barley feed': 'barley',
  chkp: 'chickpeas', chickpeas: 'chickpeas', chickpea: 'chickpeas', desi: 'chickpeas',
  lnsg: 'lentils', lentils: 'lentils', lentil: 'lentils',
  ypea: 'peas', 'yellow peas': 'peas', peas: 'peas',
  flax: 'flax',
  canary: 'canary', 'canary seed': 'canary', canaryseed: 'canary',
};

function normalizeCommodity(name) {
  if (!name) return '';
  return COMMODITY_ALIASES[name.toLowerCase().trim()] || name.toLowerCase().trim();
}

/**
 * Reconcile LGX transfer tickets against C2 delivery tickets using exact match.
 * Returns matched pairs and unmatched tickets from both sides.
 */
export async function reconcileTransferTickets(farmId, contractId, options = {}) {
  const { date_start, date_end } = options;

  // Load the terminal contract to get commodity info
  const contract = await prisma.terminalContract.findFirst({
    where: { id: contractId, farm_id: farmId },
    include: {
      commodity: { select: { id: true, name: true, code: true } },
      counterparty: { select: { id: true, name: true } },
    },
  });
  if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });

  const contractCommodityKey = normalizeCommodity(contract.commodity?.name || contract.commodity?.code);

  // 1. Load LGX inbound C2 tickets not yet on a settlement line
  const terminalWhere = {
    farm_id: farmId,
    is_c2_farms: true,
    direction: 'inbound',
    status: 'complete',
    terminal_settlement_lines: { none: {} },
  };
  // Filter by commodity if contract has one
  if (contract.commodity) {
    terminalWhere.OR = [
      { contract_id: contractId },
      { product: { contains: contract.commodity.code || contract.commodity.name, mode: 'insensitive' } },
    ];
  }

  const terminalTickets = await prisma.terminalTicket.findMany({
    where: terminalWhere,
    select: {
      id: true,
      ticket_number: true,
      ticket_date: true,
      product: true,
      weight_kg: true,
      grower_name: true,
      fmo_number: true,
      dockage_pct: true,
      moisture_pct: true,
      test_weight: true,
      protein_pct: true,
    },
    orderBy: { ticket_number: 'asc' },
  });

  // 2. Load C2 delivery tickets (unsettled)
  const { farmId: enterpriseFarmId } = await resolveInventoryFarm(farmId);
  const deliveryWhere = {
    farm_id: enterpriseFarmId,
    settled: false,
  };
  if (date_start || date_end) {
    deliveryWhere.delivery_date = {};
    if (date_start) deliveryWhere.delivery_date.gte = new Date(date_start);
    if (date_end) deliveryWhere.delivery_date.lte = new Date(date_end);
  }

  const deliveryTickets = await prisma.deliveryTicket.findMany({
    where: deliveryWhere,
    select: {
      id: true,
      ticket_number: true,
      delivery_date: true,
      net_weight_mt: true,
      net_weight_kg: true,
      grade: true,
      buyer_name: true,
      contract_number: true,
      commodity: { select: { id: true, name: true, code: true } },
    },
    orderBy: { ticket_number: 'asc' },
  });

  // Filter delivery tickets to matching commodity
  const filteredDelivery = deliveryTickets.filter(dt => {
    if (!contractCommodityKey) return true;
    const dtKey = normalizeCommodity(dt.commodity?.name || dt.commodity?.code);
    return dtKey === contractCommodityKey;
  });

  // 3. Build lookup maps for matching
  const dtByNumber = new Map();
  for (const dt of filteredDelivery) {
    if (dt.ticket_number) dtByNumber.set(dt.ticket_number, dt);
  }

  // 4. Match: primary by ticket_number, secondary by fmo_number
  const matched = [];
  const usedDeliveryIds = new Set();
  const unmatchedTerminal = [];

  for (const tt of terminalTickets) {
    const ttNum = String(tt.ticket_number);
    // Primary: exact ticket_number match
    let dt = dtByNumber.get(ttNum);
    // Secondary: fmo_number match
    if (!dt && tt.fmo_number) {
      dt = dtByNumber.get(tt.fmo_number);
    }

    if (dt && !usedDeliveryIds.has(dt.id)) {
      matched.push({
        terminal_ticket_id: tt.id,
        terminal_ticket_number: tt.ticket_number,
        terminal_date: tt.ticket_date,
        terminal_product: tt.product,
        terminal_weight_kg: tt.weight_kg,
        delivery_ticket_id: dt.id,
        delivery_ticket_number: dt.ticket_number,
        delivery_date: dt.delivery_date,
        delivery_commodity: dt.commodity?.name,
        delivery_weight_mt: dt.net_weight_mt,
        grade: dt.grade,
      });
      usedDeliveryIds.add(dt.id);
    } else {
      unmatchedTerminal.push({
        id: tt.id,
        ticket_number: tt.ticket_number,
        ticket_date: tt.ticket_date,
        product: tt.product,
        weight_kg: tt.weight_kg,
        fmo_number: tt.fmo_number,
      });
    }
  }

  // Unmatched delivery tickets (those in the filtered set that weren't matched)
  const unmatchedDelivery = filteredDelivery
    .filter(dt => !usedDeliveryIds.has(dt.id))
    .map(dt => ({
      id: dt.id,
      ticket_number: dt.ticket_number,
      delivery_date: dt.delivery_date,
      commodity: dt.commodity?.name,
      net_weight_mt: dt.net_weight_mt,
      grade: dt.grade,
      buyer_name: dt.buyer_name,
      contract_number: dt.contract_number,
    }));

  logger.info('Transfer reconciliation complete', {
    contractId,
    matched: matched.length,
    unmatchedTerminal: unmatchedTerminal.length,
    unmatchedDelivery: unmatchedDelivery.length,
  });

  return {
    contract: {
      id: contract.id,
      contract_number: contract.contract_number,
      commodity: contract.commodity?.name,
      counterparty: contract.counterparty?.name,
      contracted_mt: contract.contracted_mt,
      delivered_mt: contract.delivered_mt,
      grade_prices_json: contract.grade_prices_json,
    },
    matched,
    unmatched_terminal: unmatchedTerminal,
    unmatched_delivery: unmatchedDelivery,
    summary: {
      total_terminal: terminalTickets.length,
      total_delivery: filteredDelivery.length,
      matched: matched.length,
      matched_mt: matched.reduce((s, m) => s + (m.delivery_weight_mt || 0), 0),
    },
  };
}

/**
 * Create a settlement from approved matched pairs, apply pricing, finalize, and push.
 * Full chain: create → price → finalize → push (with pre-reconciled pairs).
 */
export async function createSettlementFromMatches(farmId, contractId, approvedMatches, options = {}) {
  const { settlement_number, notes, io } = options;

  const contract = await prisma.terminalContract.findFirst({
    where: { id: contractId, farm_id: farmId },
    include: {
      commodity: { select: { id: true, name: true, code: true } },
      counterparty: { select: { id: true, name: true } },
    },
  });
  if (!contract) throw Object.assign(new Error('Contract not found'), { status: 404 });

  // Look up terminal tickets and delivery tickets for the approved matches
  const terminalTicketIds = approvedMatches.map(m => m.terminal_ticket_id);
  const deliveryTicketIds = approvedMatches.map(m => m.delivery_ticket_id);

  const [terminalTickets, deliveryTickets] = await Promise.all([
    prisma.terminalTicket.findMany({
      where: { id: { in: terminalTicketIds } },
      select: { id: true, ticket_number: true, weight_kg: true, product: true, grower_name: true },
    }),
    prisma.deliveryTicket.findMany({
      where: { id: { in: deliveryTicketIds } },
      select: { id: true, ticket_number: true, net_weight_mt: true, grade: true, commodity: { select: { id: true, name: true } } },
    }),
  ]);

  const ttMap = new Map(terminalTickets.map(t => [t.id, t]));
  const dtMap = new Map(deliveryTickets.map(d => [d.id, d]));

  // Build settlement lines from matched pairs
  const lines = approvedMatches.map((match, idx) => {
    const tt = ttMap.get(match.terminal_ticket_id);
    const dt = dtMap.get(match.delivery_ticket_id);
    const netMt = dt?.net_weight_mt || (tt?.weight_kg ? tt.weight_kg / 1000 : 0);
    return {
      line_number: idx + 1,
      ticket_id: tt?.id || null,
      source_farm_name: tt?.grower_name || null,
      commodity_id: dt?.commodity?.id || contract.commodity?.id || null,
      grade: match.grade_override || dt?.grade || null,
      net_weight_mt: netMt,
      gross_weight_mt: netMt,
    };
  });

  // Build reconciled pairs map for pushToLogistics
  const reconciledPairs = new Map();
  for (const match of approvedMatches) {
    reconciledPairs.set(match.terminal_ticket_id, match.delivery_ticket_id);
  }

  // 1. Create settlement
  const now = new Date();
  const settlementData = {
    type: 'transfer',
    settlement_number: settlement_number || `LGX-TR-${now.toISOString().slice(0, 10).replace(/-/g, '')}`,
    counterparty_id: contract.counterparty?.id,
    contract_id: contractId,
    marketing_contract_id: null,
    settlement_date: now,
    notes: notes || 'Created via transfer reconciliation',
    lines,
  };

  const settlement = await createSettlementWithLines(farmId, settlementData);
  logger.info('Created settlement from matched pairs', { settlementId: settlement.id, lines: lines.length });

  // 2. Apply grade pricing
  try {
    await applyGradePricing(settlement.id);
    logger.info('Applied grade pricing', { settlementId: settlement.id });
  } catch (err) {
    logger.warn('Grade pricing failed — settlement left as draft for manual pricing', { error: err.message });
    return { settlement, status: 'draft', message: 'Settlement created but pricing could not be applied automatically. Edit prices manually.' };
  }

  // 3. Finalize
  const finalized = await finalizeSettlement(farmId, settlement.id);
  logger.info('Finalized settlement', { settlementId: settlement.id });

  // 4. Push to logistics with pre-reconciled pairs
  const pushed = await pushToLogistics(farmId, settlement.id, io, { reconciledPairs });
  logger.info('Pushed settlement to logistics (pre-reconciled)', { settlementId: settlement.id, logisticsSettlementId: pushed.id });

  return {
    terminal_settlement: finalized,
    logistics_settlement_id: pushed.id,
    status: 'pushed',
    matched_count: approvedMatches.length,
    total_mt: lines.reduce((s, l) => s + (l.net_weight_mt || 0), 0),
  };
}
