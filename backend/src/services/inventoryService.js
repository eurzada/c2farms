import prisma from '../config/database.js';
import { getMonthlyReconciliation } from './monthlyReconService.js';
import { getCurrentFiscalMonth } from '../utils/fiscalYear.js';

/**
 * Convert bushels to kg using the commodity's lbs_per_bu
 */
export function convertBuToKg(bushels, lbsPerBu) {
  return bushels * lbsPerBu * 0.45359237;
}

/**
 * Convert kg to metric tonnes
 */
export function convertKgToMt(kg) {
  return kg / 1000;
}

/**
 * Get the most recent count period for a farm
 */
export async function getLatestPeriod(farmId) {
  return prisma.countPeriod.findFirst({
    where: { farm_id: farmId },
    orderBy: { period_date: 'desc' },
  });
}

/**
 * Get available-to-sell per commodity:
 * total inventory MT minus contracted (open) MT
 */
export async function getAvailableToSell(farmId) {
  const latestPeriod = await getLatestPeriod(farmId);
  if (!latestPeriod) return [];

  // Get inventory by commodity from latest period
  const binCounts = await prisma.binCount.findMany({
    where: { farm_id: farmId, count_period_id: latestPeriod.id },
    include: { commodity: true },
  });

  const inventoryByCommodity = {};
  for (const bc of binCounts) {
    if (!bc.commodity || bc.commodity.code === 'FERT') continue;
    const code = bc.commodity.code;
    if (!inventoryByCommodity[code]) {
      inventoryByCommodity[code] = {
        commodity_id: bc.commodity.id,
        commodity_name: bc.commodity.name,
        commodity_code: code,
        total_kg: 0,
      };
    }
    inventoryByCommodity[code].total_kg += bc.kg;
  }

  // Committed from MarketingContract (executed + in_delivery)
  const mktContracts = await prisma.marketingContract.findMany({
    where: { farm_id: farmId, status: { in: ['executed', 'in_delivery'] } },
    include: { commodity: true },
  });

  const contractedByCommodity = {};
  for (const mc of mktContracts) {
    const code = mc.commodity.code;
    contractedByCommodity[code] = (contractedByCommodity[code] || 0) + mc.remaining_mt;
  }

  // Build result
  const result = [];
  for (const [code, inv] of Object.entries(inventoryByCommodity)) {
    const totalMt = convertKgToMt(inv.total_kg);
    const contractedMt = contractedByCommodity[code] || 0;
    const availableMt = totalMt - contractedMt;
    const pctCommitted = totalMt > 0 ? (contractedMt / totalMt) * 100 : 0;

    let signal = 'green'; // < 50% committed
    if (pctCommitted >= 80) signal = 'red';
    else if (pctCommitted >= 50) signal = 'yellow';

    result.push({
      ...inv,
      total_mt: totalMt,
      contracted_mt: contractedMt,
      available_mt: availableMt,
      pct_committed: pctCommitted,
      signal,
    });
  }

  return result.sort((a, b) => a.commodity_name.localeCompare(b.commodity_name));
}

/**
 * Get count staleness per location.
 * ✅ < 35 days, ⚠️ 35-45 days, 🔴 > 45 days
 */
export async function getFarmCountStatus(farmId) {
  const locations = await prisma.inventoryLocation.findMany({
    where: { farm_id: farmId },
    orderBy: { name: 'asc' },
  });

  const latestPeriod = await getLatestPeriod(farmId);
  const now = new Date();

  const result = [];
  for (const loc of locations) {
    // Find latest approved submission for this location
    const latestSub = await prisma.countSubmission.findFirst({
      where: {
        farm_id: farmId,
        location_id: loc.id,
        status: 'approved',
      },
      orderBy: { updated_at: 'desc' },
      include: { count_period: true },
    });

    const lastCountDate = latestSub?.count_period?.period_date || null;
    let daysSince = null;
    let status = 'unknown';

    if (lastCountDate) {
      daysSince = Math.floor((now - new Date(lastCountDate)) / (1000 * 60 * 60 * 24));
      if (daysSince < 35) status = 'current';
      else if (daysSince <= 45) status = 'warning';
      else status = 'overdue';
    }

    // Count bins at this location
    const binCount = await prisma.inventoryBin.count({
      where: { farm_id: farmId, location_id: loc.id, is_active: true },
    });

    result.push({
      location_id: loc.id,
      location_name: loc.name,
      location_code: loc.code,
      cluster: loc.cluster,
      bin_count: binCount,
      last_count_date: lastCountDate,
      days_since_count: daysSince,
      status,
    });
  }

  return result;
}

/**
 * Compute reconciliation between two count periods
 */
export async function computeReconciliation(farmId, fromPeriodId, toPeriodId) {
  const [fromPeriod, toPeriod] = await Promise.all([
    prisma.countPeriod.findFirst({ where: { id: fromPeriodId, farm_id: farmId } }),
    prisma.countPeriod.findFirst({ where: { id: toPeriodId, farm_id: farmId } }),
  ]);

  if (!fromPeriod || !toPeriod) throw new Error('Period not found');

  // Get LGX location id for wash separation
  const lgxLocation = await prisma.inventoryLocation.findFirst({
    where: { farm_id: farmId, code: 'LGX' },
    select: { id: true },
  });
  const lgxLocationId = lgxLocation?.id;

  // Get bin counts for both periods grouped by commodity (include location for LGX split)
  const [fromCounts, toCounts] = await Promise.all([
    prisma.binCount.findMany({
      where: { farm_id: farmId, count_period_id: fromPeriodId },
      include: { commodity: true, bin: { select: { location_id: true } } },
    }),
    prisma.binCount.findMany({
      where: { farm_id: farmId, count_period_id: toPeriodId },
      include: { commodity: true, bin: { select: { location_id: true } } },
    }),
  ]);

  // Aggregate by commodity, separating LGX from farm locations
  const aggregate = (counts, excludeLocationId) => {
    const result = {};
    for (const bc of counts) {
      if (excludeLocationId && bc.bin?.location_id === excludeLocationId) continue;
      const name = bc.commodity?.name || 'Unknown';
      result[name] = (result[name] || 0) + bc.kg;
    }
    return result;
  };
  const aggregateLgx = (counts, lgxLocId) => {
    const result = {};
    if (!lgxLocId) return result;
    for (const bc of counts) {
      if (bc.bin?.location_id !== lgxLocId) continue;
      const name = bc.commodity?.name || 'Unknown';
      result[name] = (result[name] || 0) + bc.kg;
    }
    return result;
  };

  // Farm inventory (excluding LGX)
  const fromAgg = aggregate(fromCounts, lgxLocationId);
  const toAgg = aggregate(toCounts, lgxLocationId);
  // LGX inventory (separate)
  const fromLgx = aggregateLgx(fromCounts, lgxLocationId);
  const toLgx = aggregateLgx(toCounts, lgxLocationId);

  // Get hauled tonnage between the two periods from DeliveryTicket (Traction Ag imports)
  // and legacy Delivery records (old inventory contracts)
  const [deliveryTickets, legacyDeliveries, settlementLines] = await Promise.all([
    prisma.deliveryTicket.findMany({
      where: {
        farm_id: farmId,
        delivery_date: {
          gt: fromPeriod.period_date,
          lte: toPeriod.period_date,
        },
      },
      include: { commodity: true },
    }),
    prisma.delivery.findMany({
      where: {
        farm_id: farmId,
        delivery_date: {
          gt: fromPeriod.period_date,
          lte: toPeriod.period_date,
        },
      },
      include: {
        contract: { include: { commodity: true } },
        marketing_contract: { include: { commodity: true } },
      },
    }),
    // Settlement lines for the period — "at elevator" tonnage
    // Match logistics dashboard: filter by line-level delivery_date, include all statuses
    prisma.settlementLine.findMany({
      where: {
        settlement: { farm_id: farmId },
        delivery_date: {
          gt: fromPeriod.period_date,
          lte: toPeriod.period_date,
        },
      },
      select: {
        commodity: true,
        net_weight_mt: true,
        settlement: {
          select: {
            marketing_contract: {
              select: { commodity: { select: { name: true } } },
            },
          },
        },
      },
    }),
  ]);

  const hauledByCommodity = {};
  const hauledToLgxByCommodity = {};

  // DeliveryTicket records (primary — Traction Ag CSV imports)
  // Separate LGX-bound tickets (internal transfers) from external shipments
  for (const dt of deliveryTickets) {
    if (!dt.commodity) continue;
    const name = dt.commodity.name;
    const isLgxBound = dt.destination && /lgx/i.test(dt.destination);
    if (isLgxBound) {
      hauledToLgxByCommodity[name] = (hauledToLgxByCommodity[name] || 0) + dt.net_weight_kg;
    } else {
      hauledByCommodity[name] = (hauledByCommodity[name] || 0) + dt.net_weight_kg;
    }
  }

  // Legacy Delivery records (old inventory contract deliveries)
  for (const d of legacyDeliveries) {
    const commodity = d.contract?.commodity || d.marketing_contract?.commodity;
    if (!commodity) continue;
    const name = commodity.name;
    hauledByCommodity[name] = (hauledByCommodity[name] || 0) + d.mt_delivered * 1000; // convert MT to kg
  }

  // Settlement lines — "at elevator" tonnage by commodity
  // Prefer marketing contract commodity name (canonical), fall back to normalized line commodity
  const atElevatorByCommodity = {};
  for (const sl of settlementLines) {
    if (!sl.net_weight_mt) continue;
    const raw = sl.settlement?.marketing_contract?.commodity?.name || sl.commodity;
    if (!raw) continue;
    const name = sl.settlement?.marketing_contract?.commodity?.name
      ? raw
      : normalizeSettlementCommodity(raw);
    atElevatorByCommodity[name] = (atElevatorByCommodity[name] || 0) + sl.net_weight_mt;
  }

  // All commodity names — only include inventory commodities + hauled, not raw settlement names
  const allCommodities = new Set([
    ...Object.keys(fromAgg), ...Object.keys(toAgg), ...Object.keys(hauledByCommodity),
  ]);
  // Merge at-elevator keys only if they match an inventory commodity
  for (const name of Object.keys(atElevatorByCommodity)) {
    if (allCommodities.has(name)) continue;
    allCommodities.add(name); // keep unmatched for visibility
  }

  const rows = [];
  for (const name of [...allCommodities].sort()) {
    const beginKg = fromAgg[name] || 0;
    const endKg = toAgg[name] || 0;
    const hauledKg = hauledByCommodity[name] || 0;
    const atElevatorMt = atElevatorByCommodity[name] || 0;
    const varianceKg = beginKg - endKg - hauledKg;
    const beginMt = convertKgToMt(beginKg);
    const endMt = convertKgToMt(endKg);
    const hauledMt = convertKgToMt(hauledKg);
    const varianceMt = convertKgToMt(varianceKg);
    const variancePct = beginMt > 0 ? (varianceMt / beginMt) * 100 : 0;

    let flag = 'ok';
    if (Math.abs(variancePct) > 5) flag = 'error';
    else if (Math.abs(variancePct) > 2) flag = 'warning';

    rows.push({
      commodity: name,
      beginning_mt: beginMt,
      ending_mt: endMt,
      hauled_mt: hauledMt,
      at_elevator_mt: atElevatorMt,
      variance_mt: varianceMt,
      variance_pct: variancePct,
      flag,
    });
  }

  // LGX wash summary — internal transfers that net to zero
  const lgxCommodities = new Set([
    ...Object.keys(fromLgx), ...Object.keys(toLgx), ...Object.keys(hauledToLgxByCommodity),
  ]);
  const lgx_rows = [];
  for (const name of [...lgxCommodities].sort()) {
    const beginKg = fromLgx[name] || 0;
    const endKg = toLgx[name] || 0;
    const transferredKg = hauledToLgxByCommodity[name] || 0;
    lgx_rows.push({
      commodity: name,
      beginning_mt: convertKgToMt(beginKg),
      ending_mt: convertKgToMt(endKg),
      transferred_in_mt: convertKgToMt(transferredKg),
    });
  }

  return {
    from_period: fromPeriod,
    to_period: toPeriod,
    rows,
    lgx: {
      rows: lgx_rows,
      total_beginning_mt: lgx_rows.reduce((s, r) => s + r.beginning_mt, 0),
      total_ending_mt: lgx_rows.reduce((s, r) => s + r.ending_mt, 0),
      total_transferred_in_mt: lgx_rows.reduce((s, r) => s + r.transferred_in_mt, 0),
    },
    summary: {
      total_beginning_mt: rows.reduce((s, r) => s + r.beginning_mt, 0),
      total_ending_mt: rows.reduce((s, r) => s + r.ending_mt, 0),
      total_hauled_mt: rows.reduce((s, r) => s + r.hauled_mt, 0),
      total_at_elevator_mt: rows.reduce((s, r) => s + r.at_elevator_mt, 0),
      total_variance_mt: rows.reduce((s, r) => s + r.variance_mt, 0),
    },
  };
}

/**
 * Normalize settlement commodity names (buyer-specific) to inventory commodity names.
 * Settlement PDFs use varied naming: "2 CWAD 13.5", "CANOLA", "Western Red Spring", etc.
 */
function normalizeSettlementCommodity(raw) {
  if (!raw) return 'Unknown';
  const s = raw.trim();
  const lower = s.toLowerCase();

  // Canola variants (keep L358 and Nexera separate)
  if (/nexera/i.test(s)) return 'Canola - Nexera';
  if (/l\s*358/i.test(s)) return 'Canola - L358';
  if (/specialty\s*canola/i.test(s) || /canada\s*specialty/i.test(s)) return 'Canola - Nexera';
  if (/canola/i.test(s) || /cc\s*canola/i.test(s)) return 'Canola';

  // Durum variants (grade codes like "2 CWAD 13.5", "Amber Durum", "CW AMBER DURUM")
  if (/cwad/i.test(s) || /durum/i.test(s) || /amber/i.test(s)) return 'Durum';

  // Spring Wheat variants
  if (/cwrs/i.test(s) || /red\s*spring/i.test(s) || /spring\s*wheat/i.test(s)
    || /wheat.*milling/i.test(s) || /meunier/i.test(s) || /western.*wheat/i.test(s)) return 'Spring Wheat';

  // Barley
  if (/barley/i.test(s)) return 'Barley';

  // Canary
  if (/canary/i.test(s)) return 'Canary Seed';

  // Lentils
  if (/eston/i.test(s) || /lentil.*sg/i.test(s) || /small.*green/i.test(s)) return 'Lentils SG';
  if (/lentil.*sr/i.test(s) || /small.*red/i.test(s)) return 'Lentils SR';
  if (/lentil/i.test(s)) return 'Lentils SG'; // default lentil type

  // Peas
  if (/pea/i.test(s)) return 'Yellow Peas';

  // Chickpeas
  if (/chickpea|garbanzo/i.test(s)) return 'Chickpeas';

  return s; // pass through unmatched
}

// Canadian standard bushel weights (lbs/bu) — authoritative reference from AFSC, CGC, Rayglen
const STANDARD_LBS_PER_BU = {
  CNLA: { lbs: 50, name: 'Canola' },
  L358: { lbs: 50, name: 'Canola - L358' },
  NXRA: { lbs: 50, name: 'Canola - Nexera' },
  CWAD: { lbs: 60, name: 'Durum' },
  CWRS: { lbs: 60, name: 'Spring Wheat' },
  BRLY: { lbs: 48, name: 'Barley' },
  BARLEY: { lbs: 48, name: 'Barley' },
  CHKP: { lbs: 60, name: 'Chickpeas' },
  LNSG: { lbs: 60, name: 'Lentils SG' },
  LNSR: { lbs: 60, name: 'Lentils SR' },
  LENTIL: { lbs: 60, name: 'Lentils' },
  YPEA: { lbs: 60, name: 'Yellow Peas' },
  CNRY: { lbs: 50, name: 'Canary Seed' },
  CANARY: { lbs: 50, name: 'Canary Seed' },
  FLAX: { lbs: 56, name: 'Flax' },
  SOAT: { lbs: 34, name: 'Oats' },
  BMUS: { lbs: 50, name: 'Brown Mustard' },
  GAR: { lbs: 60, name: 'Garbanzo Beans' },
  // FERT has no official standard — tracked but not flagged
};

/**
 * Conversion factor health check — compares DB lbs_per_bu against Canadian standards
 */
export async function getConversionFactorHealth(farmId) {
  const commodities = await prisma.commodity.findMany({
    where: { farm_id: farmId },
    select: { id: true, name: true, code: true, lbs_per_bu: true },
    orderBy: { name: 'asc' },
  });

  let okCount = 0;
  let warningCount = 0;

  const items = commodities.map(c => {
    const standard = STANDARD_LBS_PER_BU[c.code];
    if (!standard) {
      // No standard exists (e.g. FERT) — informational only
      return { ...c, standard_lbs: null, status: 'no_standard', note: 'No official standard' };
    }
    if (c.lbs_per_bu === standard.lbs) {
      okCount++;
      return { ...c, standard_lbs: standard.lbs, status: 'ok', note: null };
    }
    warningCount++;
    return {
      ...c,
      standard_lbs: standard.lbs,
      status: 'mismatch',
      note: `System: ${c.lbs_per_bu}, Standard: ${standard.lbs}`,
    };
  });

  return { items, ok_count: okCount, warning_count: warningCount, total: commodities.length };
}

/**
 * Get all dashboard data in one call.
 * Accepts optional locationId for BU-scoped views.
 */
export async function getDashboardData(farmId, { locationId } = {}) {
  const latestPeriod = await getLatestPeriod(farmId);
  if (!latestPeriod) {
    return { kpi: {}, cropInventory: [], farmStatus: [], alerts: [], drawdown: [], available_to_sell: [] };
  }

  // Current month boundaries for logistics KPIs
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  // BinCount filter — scope by location when locationId provided
  const binCountWhere = { farm_id: farmId, count_period_id: latestPeriod.id };
  if (locationId) {
    binCountWhere.bin = { location_id: locationId };
  }

  // Get all periods for drawdown
  const periods = await prisma.countPeriod.findMany({
    where: { farm_id: farmId },
    orderBy: { period_date: 'asc' },
  });

  // DeliveryTicket filter for location scoping
  const ticketLocationFilter = locationId ? { location_id: locationId } : {};

  // Run all independent queries in parallel
  const [
    latestCounts,
    mktContracts,
    hauledAgg,
    settledAgg,
    pendingSettlementsCount,
    unsettledOldTickets,
    approachingContracts,
  ] = await Promise.all([
    // Bin counts for latest period
    prisma.binCount.findMany({
      where: binCountWhere,
      include: { commodity: true, bin: { select: { location_id: true } } },
    }),
    // Committed contracts
    prisma.marketingContract.findMany({
      where: { farm_id: farmId, status: { in: ['executed', 'in_delivery'] } },
      include: { commodity: { select: { name: true } } },
    }),
    // Hauled this month (MT)
    prisma.deliveryTicket.aggregate({
      where: { farm_id: farmId, delivery_date: { gte: monthStart, lt: monthEnd }, ...ticketLocationFilter },
      _sum: { net_weight_mt: true },
      _count: true,
    }),
    // Settled this month ($)
    prisma.settlement.aggregate({
      where: { farm_id: farmId, status: 'approved', settlement_date: { gte: monthStart, lt: monthEnd } },
      _sum: { total_amount: true },
    }),
    // Pending settlements count
    prisma.settlement.count({
      where: { farm_id: farmId, status: { in: ['pending', 'disputed'] } },
    }),
    // Unsettled loads >30 days old (for alerts)
    prisma.deliveryTicket.findMany({
      where: { farm_id: farmId, settled: false, delivery_date: { lt: thirtyDaysAgo }, ...ticketLocationFilter },
      select: { ticket_number: true, buyer_name: true, delivery_date: true, net_weight_mt: true },
      orderBy: { delivery_date: 'asc' },
      take: 20,
    }),
    // Contracts approaching delivery deadline (within 14 days)
    prisma.marketingContract.findMany({
      where: {
        farm_id: farmId,
        delivery_end: { gte: now, lte: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000) },
        remaining_mt: { gt: 0 },
        status: { in: ['executed', 'in_delivery'] },
      },
      select: { contract_number: true, remaining_mt: true, delivery_end: true, commodity: { select: { name: true } } },
    }),
  ]);

  // Exclude non-grain commodities (FERT) to match marketing dashboard
  const grainCounts = latestCounts.filter(bc => bc.commodity && bc.commodity.code !== 'FERT');
  const totalKg = grainCounts.reduce((s, bc) => s + bc.kg, 0);
  const totalMt = convertKgToMt(totalKg);

  const committedMt = mktContracts.reduce((s, c) => s + c.remaining_mt, 0);
  const availableMt = totalMt - committedMt;

  // Logistics KPIs
  const hauledThisMonthMt = hauledAgg._sum.net_weight_mt || 0;
  const settledThisMonthAmount = settledAgg._sum.total_amount || 0;

  // Crop inventory table
  const cropMap = {};
  for (const bc of latestCounts) {
    if (!bc.commodity) continue;
    const name = bc.commodity.name;
    if (!cropMap[name]) {
      cropMap[name] = { commodity: name, code: bc.commodity.code, total_kg: 0, bin_count: 0 };
    }
    cropMap[name].total_kg += bc.kg;
    if (bc.bushels > 0) cropMap[name].bin_count++;
  }

  const cropInventory = Object.values(cropMap)
    .map(c => ({ ...c, total_mt: convertKgToMt(c.total_kg) }))
    .sort((a, b) => b.total_mt - a.total_mt);

  // Farm status — scope to single location for BU mode
  let farmStatus;
  if (locationId) {
    const loc = await prisma.inventoryLocation.findUnique({ where: { id: locationId } });
    if (loc) {
      const fullStatus = await getFarmCountStatus(farmId);
      farmStatus = fullStatus.filter(s => s.location_id === locationId);
    } else {
      farmStatus = await getFarmCountStatus(farmId);
    }
  } else {
    farmStatus = await getFarmCountStatus(farmId);
  }

  // Alerts
  const alerts = [];
  const overdue = farmStatus.filter(s => s.status === 'overdue');
  if (overdue.length > 0) {
    alerts.push({
      severity: 'error',
      message: `${overdue.length} location(s) overdue for counting: ${overdue.map(s => s.location_name).join(', ')}`,
    });
  }
  const warningLocs = farmStatus.filter(s => s.status === 'warning');
  if (warningLocs.length > 0) {
    alerts.push({
      severity: 'warning',
      message: `${warningLocs.length} location(s) approaching count deadline: ${warningLocs.map(s => s.location_name).join(', ')}`,
    });
  }
  if (availableMt < totalMt * 0.1) {
    alerts.push({ severity: 'warning', message: 'Less than 10% of inventory available for new contracts' });
  }

  // Unsettled loads >30 days alert
  if (unsettledOldTickets.length > 0) {
    const totalUnsettledMt = unsettledOldTickets.reduce((s, t) => s + (t.net_weight_mt || 0), 0);
    alerts.push({
      severity: 'warning',
      message: `${unsettledOldTickets.length} unsettled load(s) older than 30 days (${totalUnsettledMt.toFixed(0)} MT) — follow up with buyers`,
    });
  }

  // Contracts approaching deadline alert
  if (approachingContracts.length > 0) {
    const contractList = approachingContracts.map(c =>
      `${c.contract_number} (${c.commodity.name}, ${c.remaining_mt.toFixed(0)} MT remaining)`
    ).join('; ');
    alerts.push({
      severity: 'warning',
      message: `${approachingContracts.length} contract(s) with delivery deadline in next 14 days: ${contractList}`,
    });
  }

  // Drawdown trend: total MT per period
  const drawdown = [];
  for (const period of periods) {
    const drawdownWhere = { farm_id: farmId, count_period_id: period.id };
    if (locationId) {
      drawdownWhere.bin = { location_id: locationId };
    }
    const counts = await prisma.binCount.aggregate({
      where: drawdownWhere,
      _sum: { kg: true },
    });
    drawdown.push({
      period_date: period.period_date,
      total_mt: convertKgToMt(counts._sum.kg || 0),
    });
  }

  // Enterprise-only data
  let locationCommodityMatrix = null;
  let monthlyRecon = null;
  if (!locationId) {
    locationCommodityMatrix = await getLocationCommodityMatrix(farmId);

    // Monthly reconciliation summary for current fiscal year
    try {
      const { fiscalYear } = getCurrentFiscalMonth();
      const reconData = await getMonthlyReconciliation(farmId, fiscalYear);
      // Reshape inventory_summary into dashboard-friendly rows
      if (reconData.inventory_summary?.length > 0) {
        // Aggregate across months per commodity for a summary view
        const byCommodity = {};
        for (const row of reconData.inventory_summary) {
          if (!byCommodity[row.commodity]) {
            byCommodity[row.commodity] = {
              commodity: row.commodity,
              commodity_code: row.commodity_code,
              opening_mt: 0,
              hauled_mt: 0,
              expected_closing_mt: 0,
              actual_closing_mt: 0,
              variance_mt: 0,
              settled_mt: 0,
              unsettled_mt: 0,
            };
          }
          const c = byCommodity[row.commodity];
          // Use the earliest opening and latest closing for the period
          if (c.opening_mt === 0) c.opening_mt = row.opening_mt;
          c.actual_closing_mt = row.closing_mt; // latest month's closing
          c.hauled_mt += row.total_shipped_mt;
          c.settled_mt += row.total_settled_mt;
        }
        // Compute derived fields
        const reconRows = Object.values(byCommodity).map(c => {
          c.expected_closing_mt = Math.round((c.opening_mt - c.hauled_mt) * 100) / 100;
          c.variance_mt = Math.round((c.actual_closing_mt - c.expected_closing_mt) * 100) / 100;
          c.unsettled_mt = Math.round((c.hauled_mt - c.settled_mt) * 100) / 100;
          c.variance_pct = c.opening_mt > 0
            ? Math.round((Math.abs(c.variance_mt) / c.opening_mt) * 10000) / 100
            : 0;
          c.flag = c.variance_pct > 3 ? 'red' : c.variance_pct > 1 ? 'yellow' : 'green';
          return c;
        });
        reconRows.sort((a, b) => a.commodity.localeCompare(b.commodity));
        monthlyRecon = {
          period: reconData.period,
          rows: reconRows,
          totals: {
            opening_mt: reconRows.reduce((s, r) => s + r.opening_mt, 0),
            hauled_mt: reconRows.reduce((s, r) => s + r.hauled_mt, 0),
            expected_closing_mt: reconRows.reduce((s, r) => s + r.expected_closing_mt, 0),
            actual_closing_mt: reconRows.reduce((s, r) => s + r.actual_closing_mt, 0),
            variance_mt: reconRows.reduce((s, r) => s + r.variance_mt, 0),
            settled_mt: reconRows.reduce((s, r) => s + r.settled_mt, 0),
            unsettled_mt: reconRows.reduce((s, r) => s + r.unsettled_mt, 0),
          },
        };
      }
    } catch {
      // Monthly recon may fail if no data — ignore silently
    }
  }

  // Conversion factor health
  const conversionHealth = await getConversionFactorHealth(farmId);
  if (conversionHealth.warning_count > 0) {
    const mismatched = conversionHealth.items.filter(i => i.status === 'mismatch').map(i => i.name);
    alerts.push({
      severity: 'error',
      message: `Conversion factor mismatch: ${mismatched.join(', ')} — incorrect lbs/bu will affect all inventory calculations`,
    });
  }

  // Available-to-sell (bundled to avoid second API call)
  const availableToSell = await getAvailableToSell(farmId);

  return {
    kpi: {
      total_mt: totalMt,
      committed_mt: committedMt,
      available_mt: availableMt,
      active_contracts: mktContracts.length,
      hauled_this_month_mt: hauledThisMonthMt,
      settled_this_month_amount: settledThisMonthAmount,
      pending_settlements_count: pendingSettlementsCount,
    },
    cropInventory,
    farmStatus,
    alerts,
    drawdown,
    latest_period: latestPeriod,
    locationCommodityMatrix,
    conversionHealth,
    monthlyRecon,
    available_to_sell: availableToSell,
  };
}

/**
 * Build a location × commodity matrix of inventory MT.
 * Returns { locations: string[], commodities: string[], rows: [{ location, values: { [commodity]: mt }, total }], totals: { [commodity]: mt }, grandTotal }
 */
export async function getLocationCommodityMatrix(farmId) {
  const latestPeriod = await getLatestPeriod(farmId);
  if (!latestPeriod) return { locations: [], commodities: [], rows: [], totals: {}, grandTotal: 0 };

  const binCounts = await prisma.binCount.findMany({
    where: { farm_id: farmId, count_period_id: latestPeriod.id },
    include: {
      commodity: true,
      bin: { include: { location: true } },
    },
  });

  // Aggregate MT by location × commodity
  const matrix = {};    // { locationName: { commodityName: kgTotal } }
  const commoditySet = new Set();
  const locationSet = new Set();

  for (const bc of binCounts) {
    if (!bc.commodity || bc.commodity.code === 'FERT') continue;
    if (!bc.bin?.location) continue;

    const loc = bc.bin.location.name;
    const crop = bc.commodity.name;
    locationSet.add(loc);
    commoditySet.add(crop);

    if (!matrix[loc]) matrix[loc] = {};
    matrix[loc][crop] = (matrix[loc][crop] || 0) + bc.kg;
  }

  const locations = [...locationSet].sort();
  const commodities = [...commoditySet].sort();

  // Build rows with MT values
  const rows = locations.map(loc => {
    const values = {};
    let total = 0;
    for (const crop of commodities) {
      const mt = convertKgToMt(matrix[loc]?.[crop] || 0);
      values[crop] = mt;
      total += mt;
    }
    return { location: loc, values, total };
  });

  // Column totals
  const totals = {};
  let grandTotal = 0;
  for (const crop of commodities) {
    totals[crop] = rows.reduce((s, r) => s + (r.values[crop] || 0), 0);
    grandTotal += totals[crop];
  }

  return { locations, commodities, rows, totals, grandTotal };
}
