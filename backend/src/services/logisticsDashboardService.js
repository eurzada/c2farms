import prisma from '../config/database.js';
import { fiscalToCalendar, FISCAL_MONTHS } from '../utils/fiscalYear.js';

/**
 * Normalize raw commodity strings from settlement AI extraction to canonical names.
 * Settlement lines store whatever the AI extracted from the PDF — these need to be
 * mapped back to the Commodity table names for consistent grouping.
 */
const COMMODITY_NORMALIZE = {
  // Canola variants
  'canola': 'Canola',
  'cc canola': 'Canola',
  'specialty canola': 'Canola',
  'canada specialty canola': 'Canola',
  'nexera': 'Canola',
  'nex': 'Canola',
  // Durum variants
  'durum': 'Durum',
  'durum wheat': 'Durum',
  'amber durum': 'Durum',
  'cw amber durum': 'Durum',
  'cwad': 'Durum',
  // Spring Wheat variants
  'spring wheat': 'Spring Wheat',
  'wheat cwrs': 'Spring Wheat',
  'cwrs': 'Spring Wheat',
  'western red spring': 'Spring Wheat',
  'wheat, red spring': 'Spring Wheat',
  'feed wheat': 'Spring Wheat',
  'feed stock, ethanol,wheat': 'Spring Wheat',
  // Yellow Peas
  'yellow peas': 'Yellow Peas',
  'peas, large yellow': 'Yellow Peas',
  // Lentils
  'lentils sg': 'Lentils SG',
  'lentils sr': 'Lentils SR',
  'lentils, small red': 'Lentils SR',
  'red lentils': 'Lentils SR',
  'small red lentils': 'Lentils SR',
  'eston': 'Lentils SG',
  // Barley
  'barley': 'Barley',
  // Canary Seed
  'canary seed': 'Canary Seed',
  'canary': 'Canary Seed',
  // Chickpeas / Garbanzo
  'chickpeas': 'Chickpeas',
  'garbanzo beans': 'Chickpeas',
  // Oats
  'spring oats': 'Spring Oats',
  'oats': 'Spring Oats',
};

function normalizeCommodity(raw) {
  if (!raw) return 'Unknown';
  const lower = raw.toLowerCase().trim();
  // Direct match
  if (COMMODITY_NORMALIZE[lower]) return COMMODITY_NORMALIZE[lower];
  // Pattern matches for grade strings like "2 CWAD 13.5", "Durum (CWAD)", "Spring Wheat 13.5%"
  if (/cwad|durum/i.test(lower)) return 'Durum';
  if (/cwrs|spring wheat|wheat.*milling|meunier/i.test(lower)) return 'Spring Wheat';
  if (/barley/i.test(lower)) return 'Barley';
  if (/canola|nexera/i.test(lower)) return 'Canola';
  if (/pea/i.test(lower)) return 'Yellow Peas';
  if (/lentil.*(?:sr|small.*red|red)/i.test(lower)) return 'Lentils SR';
  if (/lentil/i.test(lower)) return 'Lentils SG';
  if (/chickpea|garbanzo/i.test(lower)) return 'Chickpeas';
  if (/canary/i.test(lower)) return 'Canary Seed';
  if (/mustard/i.test(lower)) return 'Brown Mustard';
  if (/oat/i.test(lower)) return 'Spring Oats';
  if (/wheat/i.test(lower)) return 'Spring Wheat';
  return raw; // unchanged if no match
}

// Build fiscal year date range (Nov-Oct) with optional single-month filter
function buildDateRange(fiscalYear, month) {
  if (fiscalYear && month) {
    const start = fiscalToCalendar(fiscalYear, month);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 1);
    return { gte: start, lt: end };
  }
  if (fiscalYear) {
    const start = fiscalToCalendar(fiscalYear, 'Nov');
    const end = new Date(fiscalYear, 10, 1); // Nov 1 of FY (exclusive)
    return { gte: start, lt: end };
  }
  return null;
}

/**
 * Main logistics dashboard data.
 * Returns KPIs, shipped-vs-settled chart data, unsettled loads table,
 * pending settlements, and missing loads detection.
 */
export async function getLogisticsDashboard(farmId, { fiscalYear, month } = {}) {
  const dateRange = buildDateRange(fiscalYear, month);
  const ticketDateFilter = dateRange ? { delivery_date: dateRange } : {};
  const settlementDateFilter = dateRange ? { settlement_date: dateRange } : {};

  const [kpis, shippedByCommodity, settledByCommodity, unsettledByContract, pendingSettlements, missingLoads, shippedVsConfirmed, monthlyShipments] = await Promise.all([
    getKPIs(farmId, ticketDateFilter, settlementDateFilter),
    getShippedByCommodity(farmId, ticketDateFilter),
    getSettledByCommodity(farmId, settlementDateFilter),
    getUnsettledByContract(farmId, ticketDateFilter),
    getPendingSettlements(farmId, settlementDateFilter),
    getMissingLoads(farmId, ticketDateFilter),
    getShippedVsConfirmed(farmId, ticketDateFilter),
    getMonthlyShipments(farmId, fiscalYear),
  ]);

  // Merge shipped + settled into chart data
  const commodityMap = new Map();
  for (const row of shippedByCommodity) {
    commodityMap.set(row.commodity, { commodity: row.commodity, shipped_mt: row.shipped_mt, settled_mt: 0 });
  }
  for (const row of settledByCommodity) {
    const existing = commodityMap.get(row.commodity);
    if (existing) {
      existing.settled_mt = row.settled_mt;
    } else {
      commodityMap.set(row.commodity, { commodity: row.commodity, shipped_mt: 0, settled_mt: row.settled_mt });
    }
  }
  const shipped_vs_settled = [...commodityMap.values()].sort((a, b) => b.shipped_mt - a.shipped_mt);

  return {
    kpis,
    shipped_vs_settled,
    shipped_vs_confirmed: shippedVsConfirmed,
    unsettled_by_contract: unsettledByContract,
    pending_settlements: pendingSettlements,
    missing_loads: missingLoads,
    monthly_shipments: monthlyShipments,
  };
}

async function getKPIs(farmId, ticketDateFilter, settlementDateFilter) {
  const [totalShipments, totalMTAgg, settledAmountAgg, pendingCount, exceptionCount] = await Promise.all([
    prisma.deliveryTicket.count({
      where: { farm_id: farmId, ...ticketDateFilter },
    }),
    prisma.deliveryTicket.aggregate({
      where: { farm_id: farmId, ...ticketDateFilter },
      _sum: { net_weight_mt: true },
    }),
    prisma.settlement.aggregate({
      where: { farm_id: farmId, status: 'approved', ...settlementDateFilter },
      _sum: { total_amount: true },
    }),
    prisma.settlement.count({
      where: { farm_id: farmId, status: { in: ['pending', 'disputed'] }, ...settlementDateFilter },
    }),
    prisma.settlementLine.count({
      where: {
        settlement: { farm_id: farmId, ...settlementDateFilter },
        match_status: 'exception',
      },
    }),
  ]);

  const totalMT = totalMTAgg._sum.net_weight_mt || 0;
  const settledAmount = settledAmountAgg._sum.total_amount || 0;

  return {
    total_shipments: totalShipments,
    total_mt_shipped: Math.round(totalMT * 100) / 100,
    total_settled_amount: Math.round(settledAmount * 100) / 100,
    pending_settlements: pendingCount,
    exception_lines: exceptionCount,
  };
}

async function getShippedByCommodity(farmId, ticketDateFilter) {
  const groups = await prisma.deliveryTicket.groupBy({
    by: ['commodity_id'],
    where: { farm_id: farmId, commodity_id: { not: null }, ...ticketDateFilter },
    _sum: { net_weight_mt: true },
    _count: true,
  });

  // Fetch commodity names
  const commodityIds = groups.map(g => g.commodity_id).filter(Boolean);
  const commodities = commodityIds.length > 0
    ? await prisma.commodity.findMany({ where: { id: { in: commodityIds } }, select: { id: true, name: true } })
    : [];
  const nameMap = new Map(commodities.map(c => [c.id, c.name]));

  return groups.map(g => ({
    commodity: nameMap.get(g.commodity_id) || 'Unknown',
    shipped_mt: Math.round((g._sum.net_weight_mt || 0) * 100) / 100,
    ticket_count: g._count,
  }));
}

async function getSettledByCommodity(farmId, settlementDateFilter) {
  // Settlement lines on approved settlements, grouped by commodity string
  const lines = await prisma.settlementLine.findMany({
    where: {
      settlement: { farm_id: farmId, status: 'approved', ...settlementDateFilter },
      net_weight_mt: { not: null },
    },
    select: {
      net_weight_mt: true,
      commodity: true,
      settlement: {
        select: {
          marketing_contract: {
            select: { commodity: { select: { name: true } } },
          },
        },
      },
    },
  });

  // Group by commodity name (prefer marketing contract commodity, fall back to normalized line commodity)
  const map = new Map();
  for (const line of lines) {
    const raw = line.settlement?.marketing_contract?.commodity?.name || line.commodity;
    const name = line.settlement?.marketing_contract?.commodity?.name
      ? raw  // already canonical from Commodity table
      : normalizeCommodity(raw);
    const existing = map.get(name) || { commodity: name, settled_mt: 0 };
    existing.settled_mt += line.net_weight_mt || 0;
    map.set(name, existing);
  }

  return [...map.values()].map(r => ({ ...r, settled_mt: Math.round(r.settled_mt * 100) / 100 }));
}

/**
 * Shipped (truck tickets) vs Confirmed Sold (marketing contract delivered_mt) by commodity.
 * Shipped = all DeliveryTicket MT in period.
 * Confirmed = sum of MarketingContract.delivered_mt (updated when settlements are approved).
 * The gap = grain that left the farm but isn't yet confirmed as sold.
 */
async function getShippedVsConfirmed(farmId, ticketDateFilter) {
  // For marketing contracts, filter by delivery window overlapping the ticket date range
  const contractDateFilter = ticketDateFilter.delivery_date
    ? {
      OR: [
        { delivery_start: { lte: ticketDateFilter.delivery_date.lt || new Date() }, delivery_end: { gte: ticketDateFilter.delivery_date.gte || new Date(0) } },
        { delivery_start: null, delivery_end: null },
      ],
    }
    : {};

  const [shippedGroups, contracts] = await Promise.all([
    // Shipped by commodity from tickets
    prisma.deliveryTicket.groupBy({
      by: ['commodity_id'],
      where: { farm_id: farmId, commodity_id: { not: null }, ...ticketDateFilter },
      _sum: { net_weight_mt: true },
    }),
    // Confirmed sold from marketing contracts (delivered_mt > 0)
    prisma.marketingContract.findMany({
      where: { farm_id: farmId, delivered_mt: { gt: 0 }, ...contractDateFilter },
      select: { commodity: { select: { id: true, name: true } }, delivered_mt: true },
    }),
  ]);

  // Fetch commodity names for shipped groups
  const commodityIds = shippedGroups.map(g => g.commodity_id).filter(Boolean);
  const commodities = commodityIds.length > 0
    ? await prisma.commodity.findMany({ where: { id: { in: commodityIds } }, select: { id: true, name: true } })
    : [];
  const nameMap = new Map(commodities.map(c => [c.id, c.name]));

  // Build merged map
  const map = new Map();
  for (const g of shippedGroups) {
    const name = nameMap.get(g.commodity_id) || 'Unknown';
    const existing = map.get(name) || { commodity: name, shipped_mt: 0, confirmed_mt: 0 };
    existing.shipped_mt += g._sum.net_weight_mt || 0;
    map.set(name, existing);
  }
  for (const c of contracts) {
    const name = c.commodity?.name || 'Unknown';
    const existing = map.get(name) || { commodity: name, shipped_mt: 0, confirmed_mt: 0 };
    existing.confirmed_mt += c.delivered_mt || 0;
    map.set(name, existing);
  }

  const rows = [...map.values()]
    .map(r => ({
      commodity: r.commodity,
      shipped_mt: Math.round(r.shipped_mt * 100) / 100,
      confirmed_mt: Math.round(r.confirmed_mt * 100) / 100,
      gap_mt: Math.round((r.shipped_mt - r.confirmed_mt) * 100) / 100,
    }))
    .sort((a, b) => b.shipped_mt - a.shipped_mt);

  const totals = {
    shipped_mt: Math.round(rows.reduce((s, r) => s + r.shipped_mt, 0) * 100) / 100,
    confirmed_mt: Math.round(rows.reduce((s, r) => s + r.confirmed_mt, 0) * 100) / 100,
  };
  totals.gap_mt = Math.round((totals.shipped_mt - totals.confirmed_mt) * 100) / 100;

  return { rows, totals };
}

async function getUnsettledByContract(farmId, ticketDateFilter) {
  // All tickets grouped by counterparty + contract_number
  const tickets = await prisma.deliveryTicket.findMany({
    where: { farm_id: farmId, contract_number: { not: null }, ...ticketDateFilter },
    select: {
      id: true,
      contract_number: true,
      net_weight_mt: true,
      buyer_name: true,
      counterparty: { select: { name: true, short_code: true } },
      commodity: { select: { name: true } },
      settlement_lines: { select: { id: true }, take: 1 },
    },
  });

  // Group by buyer + contract
  const groups = new Map();
  for (const t of tickets) {
    const buyer = t.counterparty?.name || t.buyer_name || 'Unknown';
    const key = `${buyer}::${t.contract_number}`;
    const g = groups.get(key) || {
      buyer,
      buyer_code: t.counterparty?.short_code || null,
      contract_number: t.contract_number,
      commodity: t.commodity?.name || null,
      shipped_count: 0,
      shipped_mt: 0,
      settled_count: 0,
      settled_mt: 0,
    };
    g.shipped_count++;
    g.shipped_mt += t.net_weight_mt || 0;
    if (t.settlement_lines.length > 0) {
      g.settled_count++;
      g.settled_mt += t.net_weight_mt || 0;
    }
    groups.set(key, g);
  }

  return [...groups.values()]
    .map(g => ({
      ...g,
      shipped_mt: Math.round(g.shipped_mt * 100) / 100,
      settled_mt: Math.round(g.settled_mt * 100) / 100,
      gap_mt: Math.round((g.shipped_mt - g.settled_mt) * 100) / 100,
    }))
    .filter(g => g.gap_mt > 0)
    .sort((a, b) => b.gap_mt - a.gap_mt);
}

async function getPendingSettlements(farmId, settlementDateFilter) {
  const settlements = await prisma.settlement.findMany({
    where: { farm_id: farmId, status: { in: ['pending', 'disputed'] }, ...settlementDateFilter },
    include: {
      counterparty: { select: { name: true, short_code: true } },
      marketing_contract: { select: { contract_number: true, commodity: { select: { name: true } } } },
      _count: { select: { lines: true } },
    },
    orderBy: { settlement_date: 'desc' },
    take: 25,
  });

  return settlements.map(s => ({
    id: s.id,
    settlement_number: s.settlement_number,
    settlement_date: s.settlement_date,
    buyer: s.counterparty?.name || null,
    buyer_code: s.counterparty?.short_code || null,
    commodity: s.marketing_contract?.commodity?.name || null,
    contract_number: s.marketing_contract?.contract_number || null,
    total_amount: s.total_amount,
    status: s.status,
    line_count: s._count.lines,
  }));
}

/**
 * Missing loads detection: find contracts where SOME tickets are on settlements
 * but OTHER tickets on the same contract have NO settlement lines at all.
 * This catches the scenario where a buyer sends a settlement covering 10 of 12 loads.
 */
async function getMissingLoads(farmId, ticketDateFilter) {
  // Get all tickets on contracts, with settlement line presence
  const tickets = await prisma.deliveryTicket.findMany({
    where: {
      farm_id: farmId,
      contract_number: { not: null },
      ...ticketDateFilter,
    },
    select: {
      id: true,
      ticket_number: true,
      contract_number: true,
      net_weight_mt: true,
      buyer_name: true,
      counterparty: { select: { name: true } },
      commodity: { select: { name: true } },
      settlement_lines: { select: { id: true }, take: 1 },
    },
  });

  // Group by contract
  const contracts = new Map();
  for (const t of tickets) {
    const key = t.contract_number;
    const c = contracts.get(key) || {
      buyer: t.counterparty?.name || t.buyer_name || 'Unknown',
      contract_number: t.contract_number,
      commodity: t.commodity?.name || null,
      total_shipped: 0,
      on_settlements: 0,
      on_settlement_mt: 0,
      missing_count: 0,
      missing_mt: 0,
      missing_tickets: [],
    };
    c.total_shipped++;
    if (t.settlement_lines.length > 0) {
      c.on_settlements++;
      c.on_settlement_mt += t.net_weight_mt || 0;
    } else {
      c.missing_count++;
      c.missing_mt += t.net_weight_mt || 0;
      c.missing_tickets.push(t.ticket_number);
    }
    contracts.set(key, c);
  }

  // Only return contracts that have BOTH some settled AND some missing
  // (pure unsettled contracts belong in the "unsettled by contract" table instead)
  return [...contracts.values()]
    .filter(c => c.on_settlements > 0 && c.missing_count > 0)
    .map(c => ({
      ...c,
      on_settlement_mt: Math.round(c.on_settlement_mt * 100) / 100,
      missing_mt: Math.round(c.missing_mt * 100) / 100,
    }))
    .sort((a, b) => b.missing_mt - a.missing_mt);
}

/**
 * Missing loads for a specific settlement.
 * Finds tickets on the same contract that are NOT on any settlement.
 */
export async function getMissingLoadsForSettlement(farmId, settlementId) {
  const settlement = await prisma.settlement.findUnique({
    where: { id: settlementId },
    select: {
      marketing_contract_id: true,
      marketing_contract: { select: { contract_number: true } },
      extraction_json: true,
    },
  });

  if (!settlement) return { missing_count: 0, missing_mt: 0, missing_tickets: [] };

  // Determine the contract number to search for
  const contractNumber = settlement.marketing_contract?.contract_number
    || settlement.extraction_json?.contract_number
    || null;

  if (!contractNumber) return { missing_count: 0, missing_mt: 0, missing_tickets: [] };

  // Find tickets on this contract with no settlement lines
  const missingTickets = await prisma.deliveryTicket.findMany({
    where: {
      farm_id: farmId,
      settlement_lines: { none: {} },
      OR: [
        { marketing_contract_id: settlement.marketing_contract_id || undefined },
        { contract_number: contractNumber },
      ].filter(c => Object.values(c).some(Boolean)),
    },
    select: {
      ticket_number: true,
      net_weight_mt: true,
      delivery_date: true,
    },
    orderBy: { delivery_date: 'asc' },
  });

  return {
    contract_number: contractNumber,
    missing_count: missingTickets.length,
    missing_mt: Math.round(missingTickets.reduce((s, t) => s + (t.net_weight_mt || 0), 0) * 100) / 100,
    missing_tickets: missingTickets.map(t => t.ticket_number),
  };
}

/**
 * Monthly shipped (tickets) vs settled (ALL settlement statuses) over the fiscal year.
 * Returns one row per fiscal month with:
 *   - shipped_mt / ticket_count from DeliveryTickets by delivery_date
 *   - settled_mt / settlement_count from SettlementLines (any status) by delivery_date on the line
 */
async function getMonthlyShipments(farmId, fiscalYear) {
  if (!fiscalYear) return [];

  const fy = parseInt(fiscalYear, 10);
  const fyStart = fiscalToCalendar(fy, 'Nov');
  const fyEnd = new Date(fy, 10, 1); // Nov 1 of FY year (exclusive)

  const [tickets, settlementLines] = await Promise.all([
    prisma.deliveryTicket.findMany({
      where: {
        farm_id: farmId,
        delivery_date: { gte: fyStart, lt: fyEnd },
      },
      select: { delivery_date: true, net_weight_mt: true },
    }),
    // ALL settlement lines regardless of settlement approval status
    prisma.settlementLine.findMany({
      where: {
        settlement: { farm_id: farmId },
        delivery_date: { gte: fyStart, lt: fyEnd },
      },
      select: {
        delivery_date: true,
        net_weight_mt: true,
        settlement: { select: { id: true, status: true } },
      },
    }),
  ]);

  // Helper: date → fiscal month label — use UTC because Prisma @db.Date = midnight UTC
  function toMonthLabel(date) {
    const d = new Date(date);
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return names[d.getUTCMonth()];
  }

  // Build shipped by month
  const shippedByMonth = {};
  for (const t of tickets) {
    const m = toMonthLabel(t.delivery_date);
    if (!shippedByMonth[m]) shippedByMonth[m] = { mt: 0, count: 0 };
    shippedByMonth[m].mt += t.net_weight_mt || 0;
    shippedByMonth[m].count += 1;
  }

  // Build settled by month — count unique settlements per month
  const settledByMonth = {};
  for (const sl of settlementLines) {
    const m = toMonthLabel(sl.delivery_date);
    if (!settledByMonth[m]) settledByMonth[m] = { mt: 0, settlement_ids: new Set() };
    settledByMonth[m].mt += sl.net_weight_mt || 0;
    settledByMonth[m].settlement_ids.add(sl.settlement.id);
  }

  // Build rows in fiscal month order (Nov → Oct)
  const rows = FISCAL_MONTHS.map(month => {
    const shipped = shippedByMonth[month] || { mt: 0, count: 0 };
    const settled = settledByMonth[month] || { mt: 0, settlement_ids: new Set() };
    const shippedMt = Math.round(shipped.mt * 100) / 100;
    const settledMt = Math.round(settled.mt * 100) / 100;
    const gap = Math.round((shippedMt - settledMt) * 100) / 100;
    return {
      month,
      shipped_mt: shippedMt,
      ticket_count: shipped.count,
      settled_mt: settledMt,
      settlement_count: settled.settlement_ids.size,
      gap_mt: gap,
    };
  });

  // Totals
  const totals = {
    shipped_mt: Math.round(rows.reduce((s, r) => s + r.shipped_mt, 0) * 100) / 100,
    ticket_count: rows.reduce((s, r) => s + r.ticket_count, 0),
    settled_mt: Math.round(rows.reduce((s, r) => s + r.settled_mt, 0) * 100) / 100,
    settlement_count: new Set(settlementLines.map(sl => sl.settlement.id)).size,
    gap_mt: Math.round(rows.reduce((s, r) => s + r.gap_mt, 0) * 100) / 100,
  };

  return { rows, totals };
}
