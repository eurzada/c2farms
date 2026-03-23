import prisma from '../config/database.js';
import { generateFiscalMonths } from '../utils/fiscalYear.js';
import { buildStatementRows, buildPdfTableBody, tableLayout as statementTableLayout } from './exportService.js';
import { getFarmCategories } from './categoryService.js';
import { getExecutiveDashboard } from './agronomyService.js';
import { getDashboard as getLabourDashboard } from './labourService.js';
import { getContractFulfillment } from './marketingService.js';
import { getAvailableToSell } from './inventoryService.js';
import createLogger from '../utils/logger.js';

const log = createLogger('production-year-report');

const HEADER_FILL = '#1565c0';
const HEADER_COLOR = '#ffffff';
const ALT_ROW = '#f5f5f5';
const DIVIDER_FILL = '#1565c0';
const DIVIDER_COLOR = '#ffffff';

export function fmt(val) {
  if (val == null || Math.abs(val) < 0.005) return '-';
  const neg = val < 0;
  const abs = Math.abs(val).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return neg ? `(${abs})` : abs;
}

export function fmtPct(val) {
  if (val == null) return '-';
  return `${val.toFixed(1)}%`;
}

export function fmtInt(val) {
  if (val == null || val === 0) return '-';
  return Math.round(val).toLocaleString('en-CA');
}

export function headerCell(text, opts = {}) {
  return { text, bold: true, fillColor: HEADER_FILL, color: HEADER_COLOR, fontSize: 7, alignment: opts.alignment || 'left', ...opts };
}

export function numCell(val, opts = {}) {
  return { text: fmt(val), alignment: 'right', ...opts };
}

export function sectionTitle(text) {
  return { text, style: 'sectionHeader', margin: [0, 10, 0, 4] };
}

export function noData(msg) {
  return { text: msg || 'No data available for this section.', italics: true, color: '#999', margin: [0, 4, 0, 8] };
}

export const compactLayout = {
  hLineWidth: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? 0.8 : 0.3,
  vLineWidth: () => 0,
  hLineColor: (i, node) => (i === 0 || i === 1 || i === node.table.body.length) ? '#999' : '#ddd',
  paddingLeft: () => 4,
  paddingRight: () => 4,
  paddingTop: () => 2,
  paddingBottom: () => 2,
};

// ─── Per-BU Section Builders ────────────────────────────────────────

export async function buildBuCropPlanSection(farmId, farmName, cropYear) {
  const dashboard = await getExecutiveDashboard(farmId, cropYear);
  if (!dashboard) return [sectionTitle(`1.1 Crop Plan — ${farmName}`), noData('No agronomy plan found.')];

  const rows = dashboard.crops.map((c, i) => [
    { text: c.crop, fillColor: i % 2 ? ALT_ROW : null },
    { text: fmtInt(c.acres), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
    numCell(c.seed_per_acre, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.fert_per_acre, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.chem_per_acre, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.total_per_acre, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.revenue, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.margin, { fillColor: i % 2 ? ALT_ROW : null }),
  ]);

  // Summary row
  const f = dashboard.farm;
  rows.push([
    { text: 'Total', bold: true },
    { text: fmtInt(f.acres), alignment: 'right', bold: true },
    numCell(f.acres > 0 ? f.seed_total / f.acres : 0, { bold: true }),
    numCell(f.acres > 0 ? f.fert_total / f.acres : 0, { bold: true }),
    numCell(f.acres > 0 ? f.chem_total / f.acres : 0, { bold: true }),
    numCell(f.cost_per_acre, { bold: true }),
    numCell(f.revenue, { bold: true }),
    numCell(f.margin, { bold: true }),
  ]);

  return [
    sectionTitle(`1.1 Crop Plan — ${farmName}`),
    {
      table: {
        headerRows: 1,
        widths: ['auto', 45, 55, 55, 55, 60, 65, 65],
        body: [
          ['Crop', 'Acres', 'Seed $/ac', 'Fert $/ac', 'Chem $/ac', 'Cost $/ac', 'Revenue', 'Margin'].map(t => headerCell(t, { alignment: t === 'Crop' ? 'left' : 'right' })),
          ...rows,
        ],
      },
      layout: compactLayout,
    },
    { text: `Margin: ${fmtPct(f.margin_pct)} | Cost/acre: ${fmt(f.cost_per_acre)}`, fontSize: 7, color: '#666', margin: [0, 2, 0, 6] },
  ];
}

export async function buildBuProcurementSection(enterpriseFarmId, buFarmId, farmName, cropYear) {
  const lines = await prisma.procurementContractLine.findMany({
    where: {
      bu_farm_id: buFarmId,
      contract: { farm_id: enterpriseFarmId, crop_year: cropYear },
    },
    include: {
      contract: { select: { contract_number: true, status: true, counterparty: { select: { name: true } } } },
    },
    orderBy: { product_name: 'asc' },
  });

  if (lines.length === 0) return [sectionTitle(`1.2 Procurement — ${farmName}`), noData('No procurement contracts allocated to this BU.')];

  const rows = lines.map((l, i) => [
    { text: l.contract.contract_number, fillColor: i % 2 ? ALT_ROW : null },
    { text: l.product_name, fillColor: i % 2 ? ALT_ROW : null },
    { text: l.input_category, fillColor: i % 2 ? ALT_ROW : null },
    { text: `${fmtInt(l.qty)} ${l.qty_unit}`, alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
    numCell(l.unit_price, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(l.line_total, { fillColor: i % 2 ? ALT_ROW : null }),
    { text: l.contract.status, fillColor: i % 2 ? ALT_ROW : null },
  ]);

  const total = lines.reduce((s, l) => s + (l.line_total || 0), 0);
  rows.push([
    { text: 'Total', bold: true, colSpan: 5 }, {}, {}, {}, {},
    numCell(total, { bold: true }),
    {},
  ]);

  return [
    sectionTitle(`1.2 Procurement — ${farmName}`),
    {
      table: {
        headerRows: 1,
        widths: ['auto', '*', 'auto', 60, 55, 65, 'auto'],
        body: [
          ['Contract #', 'Product', 'Category', 'Qty', 'Unit Price', 'Line Total', 'Status'].map(t => headerCell(t, { alignment: ['Qty', 'Unit Price', 'Line Total'].includes(t) ? 'right' : 'left' })),
          ...rows,
        ],
      },
      layout: compactLayout,
    },
  ];
}

export async function buildBuLabourSection(farmId, farmName, fiscalYear) {
  const dashboard = await getLabourDashboard(farmId, fiscalYear);
  if (!dashboard) return [sectionTitle(`1.3 Labour — ${farmName}`), noData('No labour plan found.')];

  const summaryTable = {
    table: {
      widths: ['auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        ['Avg Wage', 'Total Hours', 'Total Cost', 'Acres', 'Cost/Acre'].map(t => headerCell(t, { alignment: 'right' })),
        [
          numCell(dashboard.avg_wage),
          { text: fmtInt(dashboard.total_hours), alignment: 'right' },
          numCell(dashboard.total_cost),
          { text: fmtInt(dashboard.total_acres), alignment: 'right' },
          numCell(dashboard.cost_per_acre),
        ],
      ],
    },
    layout: compactLayout,
    margin: [0, 0, 0, 6],
  };

  const seasonRows = dashboard.seasons.map((s, i) => [
    { text: s.name, fillColor: i % 2 ? ALT_ROW : null },
    { text: fmtInt(s.hours), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
    numCell(s.cost, { fillColor: i % 2 ? ALT_ROW : null }),
    { text: String(s.role_count), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
  ]);

  return [
    sectionTitle(`1.3 Labour — ${farmName}`),
    summaryTable,
    {
      table: {
        headerRows: 1,
        widths: ['auto', 60, 70, 50],
        body: [
          ['Season', 'Hours', 'Cost', 'Roles'].map(t => headerCell(t, { alignment: t === 'Season' ? 'left' : 'right' })),
          ...seasonRows,
        ],
      },
      layout: compactLayout,
    },
  ];
}

export async function buildBuCostModelSection(farmId, farmName, fiscalYear, farmCategories, months) {
  const accountingData = await prisma.monthlyData.findMany({
    where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'accounting' },
  });

  if (accountingData.length === 0) return [sectionTitle(`1.4 Operating Statement — ${farmName}`), noData()];

  const dataMap = {};
  for (const row of accountingData) dataMap[row.month] = row.data_json || {};

  const statementRows = buildStatementRows(farmCategories, dataMap, months);
  const tableBody = buildPdfTableBody(statementRows, months);

  return [
    { text: `1.4 Operating Statement — ${farmName}`, style: 'sectionHeader', margin: [0, 10, 0, 4], pageBreak: 'before' },
    {
      table: {
        headerRows: 1,
        widths: [100, ...months.map(() => 42), 50],
        body: tableBody,
      },
      layout: statementTableLayout,
      fontSize: 6,
    },
  ];
}

export async function buildBuPerAcreSection(farmId, farmName, fiscalYear, farmCategories, months) {
  const perUnitData = await prisma.monthlyData.findMany({
    where: { farm_id: farmId, fiscal_year: fiscalYear, type: 'per_unit' },
  });

  if (perUnitData.length === 0) return [sectionTitle(`1.5 Per-Acre Analysis — ${farmName}`), noData()];

  const dataMap = {};
  for (const row of perUnitData) dataMap[row.month] = row.data_json || {};

  const statementRows = buildStatementRows(farmCategories, dataMap, months);
  const tableBody = buildPdfTableBody(statementRows, months);

  return [
    { text: `1.5 Per-Acre Analysis ($/acre) — ${farmName}`, style: 'sectionHeader', margin: [0, 10, 0, 4], pageBreak: 'before' },
    {
      table: {
        headerRows: 1,
        widths: [100, ...months.map(() => 42), 50],
        body: tableBody,
      },
      layout: statementTableLayout,
      fontSize: 6,
    },
  ];
}

// ─── Enterprise Section Builders ────────────────────────────────────

export async function buildEnterpriseMarketingSection(enterpriseFarmId) {
  const fulfillment = await getContractFulfillment(enterpriseFarmId);
  if (!fulfillment || fulfillment.length === 0) return [sectionTitle('2.1 Marketing — Contract Fulfillment'), noData('No active marketing contracts.')];

  const rows = fulfillment.map((c, i) => [
    { text: c.contract_number, fillColor: i % 2 ? ALT_ROW : null },
    { text: c.commodity, fillColor: i % 2 ? ALT_ROW : null },
    { text: c.buyer, fillColor: i % 2 ? ALT_ROW : null },
    numCell(c.contracted_mt, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.hauled_mt, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.settled_net_mt, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(c.remaining_mt, { fillColor: i % 2 ? ALT_ROW : null }),
    { text: fmtPct(c.pct_complete), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
  ]);

  return [
    sectionTitle('2.1 Marketing — Contract Fulfillment'),
    {
      table: {
        headerRows: 1,
        widths: ['auto', 'auto', 'auto', 55, 55, 55, 55, 45],
        body: [
          ['Contract #', 'Commodity', 'Buyer', 'Contracted MT', 'Hauled MT', 'Settled MT', 'Remaining', '% Done'].map(t => headerCell(t, { alignment: ['Contract #', 'Commodity', 'Buyer'].includes(t) ? 'left' : 'right' })),
          ...rows,
        ],
      },
      layout: compactLayout,
    },
  ];
}

export async function buildEnterpriseLogisticsSection(enterpriseFarmId, fiscalYear) {
  // Fiscal year date range: Nov (fiscalYear-1) to Oct (fiscalYear)
  const startDate = new Date(fiscalYear - 1, 10, 1); // Nov 1
  const endDate = new Date(fiscalYear, 10, 1); // Nov 1 next year (exclusive)

  const [ticketStats, settlementStats] = await Promise.all([
    prisma.deliveryTicket.aggregate({
      where: { farm_id: enterpriseFarmId, delivery_date: { gte: startDate, lt: endDate } },
      _count: true,
      _sum: { net_weight_mt: true },
    }),
    prisma.settlement.findMany({
      where: { farm_id: enterpriseFarmId, settlement_date: { gte: startDate, lt: endDate } },
      select: { status: true, total_amount: true },
    }),
  ]);

  const settledTicketCount = await prisma.deliveryTicket.count({
    where: { farm_id: enterpriseFarmId, delivery_date: { gte: startDate, lt: endDate }, settled: true },
  });

  const totalSettlementValue = settlementStats.reduce((s, st) => s + (st.total_amount || 0), 0);
  const approvedCount = settlementStats.filter(s => s.status === 'approved').length;
  const pendingCount = settlementStats.filter(s => s.status !== 'approved').length;

  const data = [
    ['Delivery Tickets', fmtInt(ticketStats._count), '', ''],
    ['Total Hauled MT', fmt(ticketStats._sum.net_weight_mt || 0), '', ''],
    ['Settled Tickets', fmtInt(settledTicketCount), 'Unsettled', fmtInt(ticketStats._count - settledTicketCount)],
    ['Settlements', fmtInt(settlementStats.length), 'Total Value', fmt(totalSettlementValue)],
    ['Approved', fmtInt(approvedCount), 'Pending', fmtInt(pendingCount)],
  ];

  return [
    sectionTitle('2.2 Logistics — Ticket & Settlement Summary'),
    {
      table: {
        widths: [120, 80, 120, 80],
        body: [
          ['Metric', 'Value', 'Metric', 'Value'].map(t => headerCell(t)),
          ...data.map((r, i) => r.map(v => ({ text: v, fillColor: i % 2 ? ALT_ROW : null }))),
        ],
      },
      layout: compactLayout,
    },
  ];
}

export async function buildEnterpriseInventorySection(enterpriseFarmId) {
  const available = await getAvailableToSell(enterpriseFarmId);
  if (!available || available.length === 0) return [sectionTitle('2.3 Inventory — Available to Sell'), noData('No inventory data.')];

  const rows = available.map((item, i) => [
    { text: item.commodity_name, fillColor: i % 2 ? ALT_ROW : null },
    numCell(item.total_mt, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(item.contracted_mt, { fillColor: i % 2 ? ALT_ROW : null }),
    numCell(item.available_mt, { fillColor: i % 2 ? ALT_ROW : null }),
    { text: fmtPct(item.pct_committed), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
  ]);

  return [
    sectionTitle('2.3 Inventory — Available to Sell'),
    {
      table: {
        headerRows: 1,
        widths: ['auto', 70, 70, 70, 55],
        body: [
          ['Commodity', 'Bin Count MT', 'Contracted MT', 'Available MT', '% Committed'].map(t => headerCell(t, { alignment: t === 'Commodity' ? 'left' : 'right' })),
          ...rows,
        ],
      },
      layout: compactLayout,
    },
  ];
}

// ─── Consolidated Section Builders ──────────────────────────────────

export function buildConsolidatedCropPlan(buResults) {
  // buResults = [{ farmName, dashboard }]
  const valid = buResults.filter(b => b.dashboard);
  if (valid.length === 0) return [sectionTitle('3.1 Consolidated Crop Plan'), noData()];

  const totals = { acres: 0, seed: 0, fert: 0, chem: 0, cost: 0, revenue: 0, margin: 0 };
  const rows = valid.map((b, i) => {
    const f = b.dashboard.farm;
    totals.acres += f.acres;
    totals.seed += f.seed_total;
    totals.fert += f.fert_total;
    totals.chem += f.chem_total;
    totals.cost += f.total_cost;
    totals.revenue += f.revenue;
    totals.margin += f.margin;

    return [
      { text: b.farmName, fillColor: i % 2 ? ALT_ROW : null },
      { text: fmtInt(f.acres), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
      numCell(f.cost_per_acre, { fillColor: i % 2 ? ALT_ROW : null }),
      numCell(f.revenue, { fillColor: i % 2 ? ALT_ROW : null }),
      numCell(f.margin, { fillColor: i % 2 ? ALT_ROW : null }),
      { text: fmtPct(f.margin_pct), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
    ];
  });

  rows.push([
    { text: 'Consolidated', bold: true },
    { text: fmtInt(totals.acres), alignment: 'right', bold: true },
    numCell(totals.acres > 0 ? totals.cost / totals.acres : 0, { bold: true }),
    numCell(totals.revenue, { bold: true }),
    numCell(totals.margin, { bold: true }),
    { text: fmtPct(totals.revenue > 0 ? (totals.margin / totals.revenue) * 100 : 0), alignment: 'right', bold: true },
  ]);

  return [
    sectionTitle('3.1 Consolidated Crop Plan'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 50, 60, 70, 70, 50],
        body: [
          ['BU', 'Acres', 'Cost/ac', 'Revenue', 'Margin', 'Margin %'].map(t => headerCell(t, { alignment: t === 'BU' ? 'left' : 'right' })),
          ...rows,
        ],
      },
      layout: compactLayout,
    },
  ];
}

export function buildConsolidatedLabour(buResults) {
  const valid = buResults.filter(b => b.dashboard);
  if (valid.length === 0) return [sectionTitle('3.2 Consolidated Labour'), noData()];

  const totals = { hours: 0, cost: 0, acres: 0 };
  const rows = valid.map((b, i) => {
    const d = b.dashboard;
    totals.hours += d.total_hours;
    totals.cost += d.total_cost;
    totals.acres += d.total_acres;

    return [
      { text: b.farmName, fillColor: i % 2 ? ALT_ROW : null },
      { text: fmtInt(d.total_acres), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
      { text: fmtInt(d.total_hours), alignment: 'right', fillColor: i % 2 ? ALT_ROW : null },
      numCell(d.total_cost, { fillColor: i % 2 ? ALT_ROW : null }),
      numCell(d.cost_per_acre, { fillColor: i % 2 ? ALT_ROW : null }),
    ];
  });

  rows.push([
    { text: 'Consolidated', bold: true },
    { text: fmtInt(totals.acres), alignment: 'right', bold: true },
    { text: fmtInt(totals.hours), alignment: 'right', bold: true },
    numCell(totals.cost, { bold: true }),
    numCell(totals.acres > 0 ? totals.cost / totals.acres : 0, { bold: true }),
  ]);

  return [
    sectionTitle('3.2 Consolidated Labour'),
    {
      table: {
        headerRows: 1,
        widths: ['*', 55, 55, 70, 60],
        body: [
          ['BU', 'Acres', 'Hours', 'Total Cost', 'Cost/Acre'].map(t => headerCell(t, { alignment: t === 'BU' ? 'left' : 'right' })),
          ...rows,
        ],
      },
      layout: compactLayout,
    },
  ];
}

export async function buildConsolidatedCostModel(buFarms, fiscalYear, months) {
  // Sum accounting data across all BUs
  const consolidatedMap = {};
  for (const m of months) consolidatedMap[m] = {};

  for (const farm of buFarms) {
    const data = await prisma.monthlyData.findMany({
      where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'accounting' },
    });
    for (const row of data) {
      const json = row.data_json || {};
      if (!consolidatedMap[row.month]) consolidatedMap[row.month] = {};
      for (const [code, val] of Object.entries(json)) {
        consolidatedMap[row.month][code] = (consolidatedMap[row.month][code] || 0) + Number(val || 0);
      }
    }
  }

  // Use first BU's categories (they should all be the same structure)
  const farmCategories = await getFarmCategories(buFarms[0].id);
  const statementRows = buildStatementRows(farmCategories, consolidatedMap, months);
  const tableBody = buildPdfTableBody(statementRows, months);

  return [
    { text: '3.3 Consolidated Operating Statement', style: 'sectionHeader', margin: [0, 10, 0, 4], pageBreak: 'before' },
    {
      table: {
        headerRows: 1,
        widths: [100, ...months.map(() => 42), 50],
        body: tableBody,
      },
      layout: statementTableLayout,
      fontSize: 6,
    },
  ];
}

export async function buildConsolidatedPerAcre(buFarms, fiscalYear, months) {
  // Sum accounting across all BUs, then divide by total acres
  const consolidatedMap = {};
  for (const m of months) consolidatedMap[m] = {};
  let totalAcres = 0;

  for (const farm of buFarms) {
    const [data, assumption] = await Promise.all([
      prisma.monthlyData.findMany({
        where: { farm_id: farm.id, fiscal_year: fiscalYear, type: 'accounting' },
      }),
      prisma.assumption.findUnique({
        where: { farm_id_fiscal_year: { farm_id: farm.id, fiscal_year: fiscalYear } },
      }),
    ]);
    totalAcres += assumption?.total_acres || 0;

    for (const row of data) {
      const json = row.data_json || {};
      if (!consolidatedMap[row.month]) consolidatedMap[row.month] = {};
      for (const [code, val] of Object.entries(json)) {
        consolidatedMap[row.month][code] = (consolidatedMap[row.month][code] || 0) + Number(val || 0);
      }
    }
  }

  // Divide by total acres to get weighted per-acre
  if (totalAcres > 0) {
    for (const m of months) {
      for (const code of Object.keys(consolidatedMap[m])) {
        consolidatedMap[m][code] = consolidatedMap[m][code] / totalAcres;
      }
    }
  }

  const farmCategories = await getFarmCategories(buFarms[0].id);
  const statementRows = buildStatementRows(farmCategories, consolidatedMap, months);
  const tableBody = buildPdfTableBody(statementRows, months);

  return [
    { text: `3.4 Consolidated Per-Acre Analysis ($/acre — ${fmtInt(totalAcres)} total acres)`, style: 'sectionHeader', margin: [0, 10, 0, 4], pageBreak: 'before' },
    {
      table: {
        headerRows: 1,
        widths: [100, ...months.map(() => 42), 50],
        body: tableBody,
      },
      layout: statementTableLayout,
      fontSize: 6,
    },
  ];
}

// ─── BU Divider Page ────────────────────────────────────────────────

export function buildBuDivider(farm, assumption, cropsSummary) {
  const cropsText = cropsSummary.length > 0
    ? cropsSummary.map(c => `${c.crop} (${fmtInt(c.acres)} ac)`).join('  |  ')
    : 'No crop plan';

  return [
    { text: '', pageBreak: 'before' },
    { text: ' ', margin: [0, 80, 0, 0] },
    {
      table: {
        widths: ['*'],
        body: [[{
          text: farm.name,
          fontSize: 22,
          bold: true,
          color: DIVIDER_COLOR,
          fillColor: DIVIDER_FILL,
          alignment: 'center',
          margin: [0, 20, 0, 20],
        }]],
      },
      layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
    },
    { text: `${fmtInt(assumption?.total_acres || 0)} total acres`, fontSize: 12, alignment: 'center', margin: [0, 12, 0, 4] },
    { text: cropsText, fontSize: 9, alignment: 'center', color: '#666', margin: [0, 0, 0, 0] },
  ];
}

// ─── Cover Page ─────────────────────────────────────────────────────

export function buildCoverPage(fiscalYear, buFarms, assumptions, buCropResults) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  let totalAcres = 0;
  let totalRevenue = 0;
  let totalCost = 0;
  for (const farm of buFarms) {
    const ass = assumptions[farm.id];
    totalAcres += ass?.total_acres || 0;
    const crop = buCropResults.find(r => r.farmId === farm.id);
    if (crop?.dashboard) {
      totalRevenue += crop.dashboard.farm.revenue;
      totalCost += crop.dashboard.farm.total_cost;
    }
  }
  const netMargin = totalRevenue - totalCost;

  return [
    { text: ' ', margin: [0, 100, 0, 0] },
    { text: 'C2 Farms', fontSize: 28, bold: true, alignment: 'center', color: HEADER_FILL },
    { text: 'Production Year Report', fontSize: 22, alignment: 'center', color: '#333', margin: [0, 4, 0, 20] },
    { text: `Fiscal Year ${fiscalYear} (Nov ${fiscalYear - 1} – Oct ${fiscalYear})`, fontSize: 12, alignment: 'center', color: '#666', margin: [0, 0, 0, 4] },
    { text: `Generated: ${dateStr}`, fontSize: 10, alignment: 'center', color: '#999', margin: [0, 0, 0, 30] },
    {
      table: {
        widths: ['*', '*'],
        body: [
          [
            { text: `Business Units: ${buFarms.length}`, fontSize: 10, margin: [8, 6], border: [false, false, false, false] },
            { text: `Total Acres: ${fmtInt(totalAcres)}`, fontSize: 10, margin: [8, 6], alignment: 'right', border: [false, false, false, false] },
          ],
          [
            { text: `Total Revenue: $${fmt(totalRevenue)}`, fontSize: 10, margin: [8, 6], border: [false, false, false, false] },
            { text: `Total Cost: $${fmt(totalCost)}`, fontSize: 10, margin: [8, 6], alignment: 'right', border: [false, false, false, false] },
          ],
          [
            { text: `Net Margin: $${fmt(netMargin)}`, fontSize: 10, bold: true, margin: [8, 6], colSpan: 2, alignment: 'center', border: [false, false, false, false] },
            {},
          ],
        ],
      },
      layout: {
        hLineWidth: (i, node) => (i === 0 || i === node.table.body.length) ? 1 : 0.5,
        vLineWidth: () => 0,
        hLineColor: () => '#ccc',
      },
      margin: [60, 0, 60, 0],
    },
  ];
}

// ─── Main Entry Point ───────────────────────────────────────────────

export async function generateProductionYearReport(fiscalYear) {
  log.info(`Generating production year report for FY${fiscalYear}`);

  const enterpriseFarm = await prisma.farm.findFirst({ where: { is_enterprise: true } });
  const enterpriseFarmId = enterpriseFarm?.id;

  const buFarms = await prisma.farm.findMany({
    where: { is_enterprise: false, farm_type: 'farm' },
    orderBy: { name: 'asc' },
  });

  const cropYear = fiscalYear;
  const months = generateFiscalMonths();

  // Pre-fetch assumptions for all BUs
  const assumptions = {};
  const assumptionRows = await prisma.assumption.findMany({
    where: { fiscal_year: fiscalYear, farm_id: { in: buFarms.map(f => f.id) } },
  });
  for (const a of assumptionRows) assumptions[a.farm_id] = a;

  // Pre-fetch crop dashboards for cover page + consolidated
  const buCropResults = [];
  for (const farm of buFarms) {
    const dashboard = await getExecutiveDashboard(farm.id, cropYear);
    buCropResults.push({ farmId: farm.id, farmName: farm.name, dashboard });
  }

  // Pre-fetch labour dashboards for consolidated
  const buLabourResults = [];
  for (const farm of buFarms) {
    const dashboard = await getLabourDashboard(farm.id, fiscalYear);
    buLabourResults.push({ farmId: farm.id, farmName: farm.name, dashboard });
  }

  // Cover page
  const content = [...buildCoverPage(fiscalYear, buFarms, assumptions, buCropResults)];

  // ── Part 1: Per Business Unit ──
  content.push(
    { text: '', pageBreak: 'before' },
    { text: ' ', margin: [0, 80, 0, 0] },
    { text: 'Part 1: Business Unit Detail', fontSize: 20, bold: true, alignment: 'center', color: HEADER_FILL },
    { text: 'Crop Plan  |  Procurement  |  Labour  |  Cost Model  |  Per-Acre', fontSize: 10, alignment: 'center', color: '#999', margin: [0, 8, 0, 0] },
  );

  for (const farm of buFarms) {
    const assumption = assumptions[farm.id];
    const cropResult = buCropResults.find(r => r.farmId === farm.id);
    const cropsSummary = cropResult?.dashboard?.crops?.map(c => ({ crop: c.crop, acres: c.acres })) || [];

    // BU divider page
    content.push(...buildBuDivider(farm, assumption, cropsSummary));

    // Fetch farm categories once per BU
    const farmCategories = await getFarmCategories(farm.id);

    // Build sections (reuse pre-fetched crop/labour where possible)
    const cropSection = cropResult?.dashboard
      ? await buildBuCropPlanSection(farm.id, farm.name, cropYear)
      : [sectionTitle(`1.1 Crop Plan — ${farm.name}`), noData('No agronomy plan found.')];

    const [procurementSection, labourSection, costModelSection, perAcreSection] = await Promise.all([
      enterpriseFarmId ? buildBuProcurementSection(enterpriseFarmId, farm.id, farm.name, cropYear) : [sectionTitle(`1.2 Procurement — ${farm.name}`), noData()],
      buildBuLabourSection(farm.id, farm.name, fiscalYear),
      buildBuCostModelSection(farm.id, farm.name, fiscalYear, farmCategories, months),
      buildBuPerAcreSection(farm.id, farm.name, fiscalYear, farmCategories, months),
    ]);

    content.push(...cropSection, ...procurementSection, ...labourSection, ...costModelSection, ...perAcreSection);
  }

  // ── Part 2: Enterprise ──
  content.push(
    { text: '', pageBreak: 'before' },
    { text: ' ', margin: [0, 80, 0, 0] },
    { text: 'Part 2: Enterprise', fontSize: 20, bold: true, alignment: 'center', color: HEADER_FILL },
    { text: 'Marketing  |  Logistics  |  Inventory', fontSize: 10, alignment: 'center', color: '#999', margin: [0, 8, 0, 0] },
  );

  if (enterpriseFarmId) {
    const [marketingSection, logisticsSection, inventorySection] = await Promise.all([
      buildEnterpriseMarketingSection(enterpriseFarmId),
      buildEnterpriseLogisticsSection(enterpriseFarmId, fiscalYear),
      buildEnterpriseInventorySection(enterpriseFarmId),
    ]);
    content.push(...marketingSection, ...logisticsSection, ...inventorySection);
  } else {
    content.push(noData('No enterprise farm found.'));
  }

  // ── Part 3: Consolidated Rollup ──
  content.push(
    { text: '', pageBreak: 'before' },
    { text: ' ', margin: [0, 80, 0, 0] },
    { text: 'Part 3: Consolidated Rollup', fontSize: 20, bold: true, alignment: 'center', color: HEADER_FILL },
    { text: 'All Business Units Combined', fontSize: 10, alignment: 'center', color: '#999', margin: [0, 8, 0, 0] },
  );

  if (buFarms.length > 0) {
    const consolidatedCropPlan = buildConsolidatedCropPlan(buCropResults);
    const consolidatedLabour = buildConsolidatedLabour(buLabourResults);
    const [consolidatedCostModel, consolidatedPerAcre] = await Promise.all([
      buildConsolidatedCostModel(buFarms, fiscalYear, months),
      buildConsolidatedPerAcre(buFarms, fiscalYear, months),
    ]);
    content.push(...consolidatedCropPlan, ...consolidatedLabour, ...consolidatedCostModel, ...consolidatedPerAcre);
  }

  const docDefinition = {
    pageOrientation: 'landscape',
    pageSize: 'LETTER',
    pageMargins: [30, 40, 30, 30],
    content,
    styles: {
      title: { fontSize: 16, bold: true, margin: [0, 0, 0, 4] },
      subtitle: { fontSize: 10, color: '#666' },
      sectionHeader: { fontSize: 11, bold: true, color: '#1565c0' },
      sectionDesc: { fontSize: 8, color: '#666', italics: true },
    },
    defaultStyle: {
      fontSize: 7,
      font: 'Roboto',
    },
    footer: (currentPage, pageCount) => ({
      columns: [
        { text: `C2 Farms — Production Year Report FY${fiscalYear}`, fontSize: 7, color: '#999', margin: [30, 0, 0, 0] },
        { text: `Page ${currentPage} of ${pageCount}`, fontSize: 7, color: '#999', alignment: 'right', margin: [0, 0, 30, 0] },
      ],
    }),
  };

  return docDefinition;
}
