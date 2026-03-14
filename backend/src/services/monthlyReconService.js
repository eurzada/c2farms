import prisma from '../config/database.js';
import createLogger from '../utils/logger.js';
import { fiscalToCalendar } from '../utils/fiscalYear.js';

const log = createLogger('monthly-recon');

const FISCAL_MONTHS = ['Nov', 'Dec', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct'];

function round2(v) { return Math.round((v || 0) * 100) / 100; }

/**
 * Three-way monthly reconciliation:
 *   Shipped (delivery tickets) vs Settled (settlement lines) vs Inventory Change (bin count delta)
 *
 * Grouped by commodity + buyer, month by month within a fiscal year.
 */
export async function getMonthlyReconciliation(farmId, fiscalYear, { startDate, endDate } = {}) {
  const fy = parseInt(fiscalYear, 10);
  const fyStart = startDate ? new Date(startDate) : fiscalToCalendar(fy, 'Nov');
  const fyEnd = endDate ? new Date(new Date(endDate).getTime() + 86400000) : new Date(fy, 10, 1); // endDate is inclusive

  log.info('Monthly reconciliation', { farmId, fiscalYear: fy });

  // 1. Shipped: DeliveryTickets grouped by commodity + buyer + month
  const tickets = await prisma.deliveryTicket.findMany({
    where: {
      farm_id: farmId,
      delivery_date: { gte: fyStart, lt: fyEnd },
    },
    select: {
      delivery_date: true,
      net_weight_mt: true,
      buyer_name: true,
      commodity: { select: { name: true, code: true } },
    },
  });

  // 2. Settled: SettlementLines via their settlements, grouped same way
  const settlementLines = await prisma.settlementLine.findMany({
    where: {
      settlement: {
        farm_id: farmId,
        status: 'approved',
      },
      delivery_date: { gte: fyStart, lt: fyEnd },
    },
    select: {
      delivery_date: true,
      net_weight_mt: true,
      settlement: {
        select: {
          counterparty: { select: { name: true } },
          marketing_contract: { select: { commodity: { select: { name: true, code: true } } } },
          extraction_json: true,
        },
      },
    },
  });

  // 3. Inventory: BinCount by period (get all periods in this FY)
  const periods = await prisma.countPeriod.findMany({
    where: {
      farm_id: farmId,
      period_date: { gte: fyStart, lt: fyEnd },
    },
    orderBy: { period_date: 'asc' },
    select: { id: true, period_date: true, crop_year: true },
  });

  // Get the period just before FY start for opening balance
  const priorPeriod = await prisma.countPeriod.findFirst({
    where: { farm_id: farmId, period_date: { lt: fyStart } },
    orderBy: { period_date: 'desc' },
    select: { id: true, period_date: true },
  });

  // Fetch bin counts for all relevant periods (prior + in-FY)
  const allPeriodIds = [...(priorPeriod ? [priorPeriod.id] : []), ...periods.map(p => p.id)];
  const binCounts = await prisma.binCount.findMany({
    where: {
      farm_id: farmId,
      count_period_id: { in: allPeriodIds },
    },
    select: {
      count_period_id: true,
      kg: true,
      bin: { select: { commodity: { select: { name: true, code: true } } } },
    },
  });

  // Aggregate bin counts by period + commodity
  const invByPeriodCommodity = {};
  for (const bc of binCounts) {
    const code = bc.bin?.commodity?.code || 'UNK';
    if (code === 'FERT') continue;
    const key = `${bc.count_period_id}|${code}`;
    invByPeriodCommodity[key] = (invByPeriodCommodity[key] || 0) + (bc.kg || 0) / 1000;
  }

  // Build month lookup helper
  function getMonthKey(date) {
    if (!date) return null;
    const d = new Date(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function monthToFiscalLabel(monthKey) {
    const [y, m] = monthKey.split('-').map(Number);
    const monthNames = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[m]} ${y}`;
  }

  // Aggregate shipped by commodity+buyer+month
  const shippedMap = {};
  for (const t of tickets) {
    const mk = getMonthKey(t.delivery_date);
    if (!mk) continue;
    const commodity = t.commodity?.name || 'Unknown';
    const buyer = t.buyer_name || 'Unknown';
    const key = `${commodity}|${buyer}|${mk}`;
    if (!shippedMap[key]) shippedMap[key] = { commodity, buyer, month: mk, shipped_mt: 0, ticket_count: 0 };
    shippedMap[key].shipped_mt += t.net_weight_mt || 0;
    shippedMap[key].ticket_count += 1;
  }

  // Aggregate settled by commodity+buyer+month
  const settledMap = {};
  for (const sl of settlementLines) {
    const mk = getMonthKey(sl.delivery_date);
    if (!mk) continue;
    const commodity = sl.settlement.marketing_contract?.commodity?.name
      || sl.settlement.extraction_json?.commodity || 'Unknown';
    const buyer = sl.settlement.counterparty?.name || 'Unknown';
    const key = `${commodity}|${buyer}|${mk}`;
    if (!settledMap[key]) settledMap[key] = { commodity, buyer, month: mk, settled_mt: 0, line_count: 0 };
    settledMap[key].settled_mt += sl.net_weight_mt || 0;
    settledMap[key].line_count += 1;
  }

  // Build inventory delta by commodity per period-pair
  const inventoryDeltas = {};
  const sortedPeriods = priorPeriod
    ? [priorPeriod, ...periods]
    : periods;

  for (let i = 1; i < sortedPeriods.length; i++) {
    const prev = sortedPeriods[i - 1];
    const curr = sortedPeriods[i];
    const mk = getMonthKey(curr.period_date);

    // Get all commodity codes from both periods
    const codes = new Set();
    for (const k of Object.keys(invByPeriodCommodity)) {
      const [pid, code] = k.split('|');
      if (pid === prev.id || pid === curr.id) codes.add(code);
    }

    for (const code of codes) {
      const prevMt = invByPeriodCommodity[`${prev.id}|${code}`] || 0;
      const currMt = invByPeriodCommodity[`${curr.id}|${code}`] || 0;
      const delta = prevMt - currMt; // positive = inventory decreased (grain left)
      const key = `${code}|${mk}`;
      inventoryDeltas[key] = { code, month: mk, opening_mt: prevMt, closing_mt: currMt, delta_mt: delta };
    }
  }

  // Merge into unified rows: commodity + buyer + month
  const allKeys = new Set([
    ...Object.keys(shippedMap),
    ...Object.keys(settledMap),
  ]);

  const rows = [];
  for (const key of allKeys) {
    const shipped = shippedMap[key] || {};
    const settled = settledMap[key] || {};
    const [commodity, buyer, month] = key.split('|');

    const shippedMt = round2(shipped.shipped_mt || 0);
    const settledMt = round2(settled.settled_mt || 0);
    const variance = round2(shippedMt - settledMt);
    const variancePct = shippedMt > 0 ? round2((variance / shippedMt) * 100) : 0;

    let flag = 'ok';
    if (Math.abs(variancePct) > 5) flag = 'error';
    else if (Math.abs(variancePct) > 2) flag = 'warning';

    rows.push({
      commodity,
      buyer,
      month,
      month_label: monthToFiscalLabel(month),
      shipped_mt: shippedMt,
      ticket_count: shipped.ticket_count || 0,
      settled_mt: settledMt,
      line_count: settled.line_count || 0,
      variance_mt: variance,
      variance_pct: variancePct,
      flag,
    });
  }

  rows.sort((a, b) => a.commodity.localeCompare(b.commodity) || a.buyer.localeCompare(b.buyer) || a.month.localeCompare(b.month));

  // Inventory summary by commodity per month (separate from buyer detail)
  const inventorySummary = [];
  for (const [key, delta] of Object.entries(inventoryDeltas)) {
    const [code, month] = key.split('|');
    // Find commodity name from tickets or bins
    const commodityName = tickets.find(t => t.commodity?.code === code)?.commodity?.name || code;

    // Sum shipped and settled for this commodity+month across all buyers
    let totalShipped = 0, totalSettled = 0;
    for (const r of rows) {
      if (r.commodity === commodityName && r.month === month) {
        totalShipped += r.shipped_mt;
        totalSettled += r.settled_mt;
      }
    }

    const invChange = round2(delta.delta_mt); // positive = grain left bins
    const expectedChange = round2(totalShipped); // shipped should ≈ inventory decrease
    const invVariance = round2(invChange - expectedChange);

    inventorySummary.push({
      commodity: commodityName,
      commodity_code: code,
      month,
      month_label: monthToFiscalLabel(month),
      opening_mt: round2(delta.opening_mt),
      closing_mt: round2(delta.closing_mt),
      inventory_change_mt: invChange,
      total_shipped_mt: round2(totalShipped),
      total_settled_mt: round2(totalSettled),
      inv_vs_shipped_variance: invVariance,
      flag: Math.abs(invVariance) > (expectedChange * 0.05) ? 'warning' : 'ok',
    });
  }

  inventorySummary.sort((a, b) => a.commodity.localeCompare(b.commodity) || a.month.localeCompare(b.month));

  // Grand totals
  const totals = {
    total_shipped_mt: round2(rows.reduce((s, r) => s + r.shipped_mt, 0)),
    total_settled_mt: round2(rows.reduce((s, r) => s + r.settled_mt, 0)),
    total_variance_mt: round2(rows.reduce((s, r) => s + r.variance_mt, 0)),
    total_tickets: rows.reduce((s, r) => s + r.ticket_count, 0),
    total_settlement_lines: rows.reduce((s, r) => s + r.line_count, 0),
    months_covered: [...new Set(rows.map(r => r.month))].length,
    commodities: [...new Set(rows.map(r => r.commodity))],
    buyers: [...new Set(rows.map(r => r.buyer))],
    error_count: rows.filter(r => r.flag === 'error').length,
    warning_count: rows.filter(r => r.flag === 'warning').length,
  };

  const periodLabel = startDate || endDate
    ? `${fyStart.toLocaleDateString('en-CA')} – ${new Date(fyEnd.getTime() - 86400000).toLocaleDateString('en-CA')}`
    : `Nov ${fy - 1} – Oct ${fy}`;

  return {
    fiscal_year: fy,
    period: periodLabel,
    detail: rows,
    inventory_summary: inventorySummary,
    totals,
  };
}
