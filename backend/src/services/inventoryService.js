import prisma from '../config/database.js';

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
    if (!bc.commodity) continue;
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

  // Get contracted amounts for open contracts
  const contracts = await prisma.contract.findMany({
    where: { farm_id: farmId, status: 'open' },
    include: { commodity: true },
  });

  const contractedByCommodity = {};
  for (const c of contracts) {
    const code = c.commodity.code;
    contractedByCommodity[code] = (contractedByCommodity[code] || 0) + c.contracted_mt;
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
    prisma.countPeriod.findUnique({ where: { id: fromPeriodId } }),
    prisma.countPeriod.findUnique({ where: { id: toPeriodId } }),
  ]);

  if (!fromPeriod || !toPeriod) throw new Error('Period not found');

  // Get bin counts for both periods grouped by commodity
  const [fromCounts, toCounts] = await Promise.all([
    prisma.binCount.findMany({
      where: { farm_id: farmId, count_period_id: fromPeriodId },
      include: { commodity: true },
    }),
    prisma.binCount.findMany({
      where: { farm_id: farmId, count_period_id: toPeriodId },
      include: { commodity: true },
    }),
  ]);

  // Aggregate by commodity
  const aggregate = (counts) => {
    const result = {};
    for (const bc of counts) {
      const name = bc.commodity?.name || 'Unknown';
      result[name] = (result[name] || 0) + bc.kg;
    }
    return result;
  };

  const fromAgg = aggregate(fromCounts);
  const toAgg = aggregate(toCounts);

  // Get deliveries between the two periods
  const deliveries = await prisma.delivery.findMany({
    where: {
      farm_id: farmId,
      delivery_date: {
        gt: fromPeriod.period_date,
        lte: toPeriod.period_date,
      },
    },
    include: { contract: { include: { commodity: true } } },
  });

  const hauledByCommodity = {};
  for (const d of deliveries) {
    const name = d.contract.commodity.name;
    hauledByCommodity[name] = (hauledByCommodity[name] || 0) + d.mt_delivered * 1000; // convert MT to kg
  }

  // All commodity names
  const allCommodities = new Set([...Object.keys(fromAgg), ...Object.keys(toAgg)]);

  const rows = [];
  for (const name of [...allCommodities].sort()) {
    const beginKg = fromAgg[name] || 0;
    const endKg = toAgg[name] || 0;
    const hauledKg = hauledByCommodity[name] || 0;
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
      variance_mt: varianceMt,
      variance_pct: variancePct,
      flag,
    });
  }

  return {
    from_period: fromPeriod,
    to_period: toPeriod,
    rows,
    summary: {
      total_beginning_mt: rows.reduce((s, r) => s + r.beginning_mt, 0),
      total_ending_mt: rows.reduce((s, r) => s + r.ending_mt, 0),
      total_hauled_mt: rows.reduce((s, r) => s + r.hauled_mt, 0),
      total_variance_mt: rows.reduce((s, r) => s + r.variance_mt, 0),
    },
  };
}

/**
 * Get all dashboard data in one call
 */
export async function getDashboardData(farmId) {
  const latestPeriod = await getLatestPeriod(farmId);
  if (!latestPeriod) {
    return { kpi: {}, cropInventory: [], farmStatus: [], alerts: [], drawdown: [] };
  }

  // Get all periods for drawdown
  const periods = await prisma.countPeriod.findMany({
    where: { farm_id: farmId },
    orderBy: { period_date: 'asc' },
  });

  // Get bin counts for latest period
  const latestCounts = await prisma.binCount.findMany({
    where: { farm_id: farmId, count_period_id: latestPeriod.id },
    include: { commodity: true },
  });

  const totalKg = latestCounts.reduce((s, bc) => s + bc.kg, 0);
  const totalMt = convertKgToMt(totalKg);

  // Contracts
  const contracts = await prisma.contract.findMany({
    where: { farm_id: farmId },
    include: { commodity: true, deliveries: true },
  });

  const openContracts = contracts.filter(c => c.status === 'open');
  const committedMt = openContracts.reduce((s, c) => s + c.contracted_mt, 0);
  const availableMt = totalMt - committedMt;

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

  // Farm status
  const farmStatus = await getFarmCountStatus(farmId);

  // Alerts
  const alerts = [];
  const overdue = farmStatus.filter(s => s.status === 'overdue');
  if (overdue.length > 0) {
    alerts.push({
      severity: 'error',
      message: `${overdue.length} location(s) overdue for counting: ${overdue.map(s => s.location_name).join(', ')}`,
    });
  }
  const warning = farmStatus.filter(s => s.status === 'warning');
  if (warning.length > 0) {
    alerts.push({
      severity: 'warning',
      message: `${warning.length} location(s) approaching count deadline: ${warning.map(s => s.location_name).join(', ')}`,
    });
  }
  if (availableMt < totalMt * 0.1) {
    alerts.push({ severity: 'warning', message: 'Less than 10% of inventory available for new contracts' });
  }

  // Drawdown trend: total MT per period
  const drawdown = [];
  for (const period of periods) {
    const counts = await prisma.binCount.aggregate({
      where: { farm_id: farmId, count_period_id: period.id },
      _sum: { kg: true },
    });
    drawdown.push({
      period_date: period.period_date,
      total_mt: convertKgToMt(counts._sum.kg || 0),
    });
  }

  return {
    kpi: {
      total_mt: totalMt,
      committed_mt: committedMt,
      available_mt: availableMt,
      active_contracts: openContracts.length,
    },
    cropInventory,
    farmStatus,
    alerts,
    drawdown,
    latest_period: latestPeriod,
  };
}
