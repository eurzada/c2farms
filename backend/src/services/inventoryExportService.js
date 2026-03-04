import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import {
  getLatestPeriod, getAvailableToSell, convertKgToMt,
} from './inventoryService.js';

// ─── Data fetchers (shared by all export formats) ───

async function getBinInventoryData(farmId, { locationId } = {}) {
  const latestPeriod = await getLatestPeriod(farmId);
  if (!latestPeriod) return { rows: [], periodLabel: 'N/A' };

  const where = { farm_id: farmId, is_active: true };
  if (locationId) where.location_id = locationId;

  const bins = await prisma.inventoryBin.findMany({
    where,
    include: {
      location: true,
      commodity: true,
      bin_counts: {
        where: { count_period_id: latestPeriod.id },
        take: 1,
        include: { commodity: true },
      },
    },
    orderBy: [{ location: { name: 'asc' } }, { bin_number: 'asc' }],
  });

  const rows = bins.map(bin => {
    const count = bin.bin_counts[0];
    const kg = count?.kg || 0;
    return {
      location: bin.location.name,
      bin_number: bin.bin_number,
      bin_type: bin.bin_type,
      capacity_bu: bin.capacity_bu,
      commodity: count?.commodity?.name || bin.commodity?.name || '',
      bushels: count?.bushels || 0,
      kg,
      mt: convertKgToMt(kg),
      crop_year: count?.crop_year || '',
    };
  });

  const periodLabel = latestPeriod.period_date.toISOString().split('T')[0];
  return { rows, periodLabel };
}

async function getContractsData(farmId) {
  const contracts = await prisma.contract.findMany({
    where: { farm_id: farmId },
    include: { commodity: true, deliveries: true },
    orderBy: { created_at: 'desc' },
  });

  const rows = contracts.map(c => {
    const hauledMt = c.deliveries.reduce((s, d) => s + d.mt_delivered, 0);
    return {
      contract_number: c.contract_number || '',
      buyer: c.buyer,
      commodity: c.commodity.name,
      contracted_mt: c.contracted_mt,
      hauled_mt: hauledMt,
      remaining_mt: c.contracted_mt - hauledMt,
      pct_complete: c.contracted_mt > 0 ? (hauledMt / c.contracted_mt) * 100 : 0,
      status: c.status,
    };
  });

  // Include marketing contracts
  const mktContracts = await prisma.marketingContract.findMany({
    where: { farm_id: farmId },
    include: { commodity: true, counterparty: true },
    orderBy: { created_at: 'desc' },
  });

  for (const mc of mktContracts) {
    rows.push({
      contract_number: mc.contract_number || '',
      buyer: mc.counterparty?.name || '',
      commodity: mc.commodity.name,
      contracted_mt: mc.contracted_mt,
      hauled_mt: mc.delivered_mt,
      remaining_mt: mc.remaining_mt,
      pct_complete: mc.contracted_mt > 0 ? (mc.delivered_mt / mc.contracted_mt) * 100 : 0,
      status: mc.status,
    });
  }

  return rows;
}

async function getReconciliationData(farmId) {
  const periods = await prisma.countPeriod.findMany({
    where: { farm_id: farmId },
    orderBy: { period_date: 'asc' },
  });

  if (periods.length < 2) return [];

  const fromPeriod = periods[periods.length - 2];
  const toPeriod = periods[periods.length - 1];

  const [fromCounts, toCounts] = await Promise.all([
    prisma.binCount.findMany({
      where: { farm_id: farmId, count_period_id: fromPeriod.id },
      include: { commodity: true },
    }),
    prisma.binCount.findMany({
      where: { farm_id: farmId, count_period_id: toPeriod.id },
      include: { commodity: true },
    }),
  ]);

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

  const deliveries = await prisma.delivery.findMany({
    where: {
      farm_id: farmId,
      delivery_date: { gt: fromPeriod.period_date, lte: toPeriod.period_date },
    },
    include: {
      contract: { include: { commodity: true } },
      marketing_contract: { include: { commodity: true } },
    },
  });

  const hauledByCommodity = {};
  for (const d of deliveries) {
    const commodity = d.contract?.commodity || d.marketing_contract?.commodity;
    if (!commodity) continue;
    const name = commodity.name;
    hauledByCommodity[name] = (hauledByCommodity[name] || 0) + d.mt_delivered * 1000;
  }

  const allCommodities = new Set([...Object.keys(fromAgg), ...Object.keys(toAgg)]);
  return [...allCommodities].sort().map(name => {
    const beginKg = fromAgg[name] || 0;
    const endKg = toAgg[name] || 0;
    const hauledKg = hauledByCommodity[name] || 0;
    const varianceKg = beginKg - endKg - hauledKg;
    const beginMt = convertKgToMt(beginKg);
    const endMt = convertKgToMt(endKg);
    const varianceMt = convertKgToMt(varianceKg);
    return {
      commodity: name,
      beginning_mt: beginMt,
      ending_mt: endMt,
      hauled_mt: convertKgToMt(hauledKg),
      variance_mt: varianceMt,
      variance_pct: beginMt > 0 ? (varianceMt / beginMt) * 100 : 0,
    };
  });
}

// ─── Excel Export ───

export async function generateInventoryExcel(farmId) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'C2 Farms';

  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  const farmName = farm?.name || 'Farm';
  const numFmt = '#,##0.00';
  const intFmt = '#,##0';

  // Sheet 1: Current Inventory
  const { rows: binRows, periodLabel } = await getBinInventoryData(farmId);
  const invSheet = workbook.addWorksheet('Current Inventory');
  invSheet.addRow([`${farmName} — Bin Inventory (${periodLabel})`]).font = { bold: true, size: 12 };
  invSheet.addRow([]);
  const invHeader = invSheet.addRow(['Location', 'Bin #', 'Type', 'Capacity (bu)', 'Commodity', 'Bushels', 'KG', 'MT', 'Crop Year']);
  invHeader.font = { bold: true };
  invSheet.views = [{ state: 'frozen', ySplit: 3 }];

  for (const r of binRows) {
    const row = invSheet.addRow([r.location, r.bin_number, r.bin_type, r.capacity_bu, r.commodity, r.bushels, r.kg, r.mt, r.crop_year]);
    row.getCell(4).numFmt = intFmt;
    row.getCell(6).numFmt = intFmt;
    row.getCell(7).numFmt = intFmt;
    row.getCell(8).numFmt = numFmt;
  }

  // Subtotals by location
  invSheet.addRow([]);
  const locSummary = invSheet.addRow(['TOTALS', '', '', '', '', '', '', binRows.reduce((s, r) => s + r.mt, 0)]);
  locSummary.font = { bold: true };
  locSummary.getCell(8).numFmt = numFmt;

  invSheet.columns = [
    { width: 14 }, { width: 10 }, { width: 10 }, { width: 14 },
    { width: 16 }, { width: 12 }, { width: 12 }, { width: 12 }, { width: 12 },
  ];

  // Sheet 2: Contracts
  const contractRows = await getContractsData(farmId);
  const conSheet = workbook.addWorksheet('Contracts');
  conSheet.addRow([`${farmName} — Contracts`]).font = { bold: true, size: 12 };
  conSheet.addRow([]);
  const conHeader = conSheet.addRow(['Contract #', 'Buyer', 'Commodity', 'Contracted MT', 'Hauled MT', 'Remaining MT', '% Complete', 'Status']);
  conHeader.font = { bold: true };
  conSheet.views = [{ state: 'frozen', ySplit: 3 }];

  for (const c of contractRows) {
    const row = conSheet.addRow([c.contract_number, c.buyer, c.commodity, c.contracted_mt, c.hauled_mt, c.remaining_mt, c.pct_complete / 100, c.status]);
    row.getCell(4).numFmt = numFmt;
    row.getCell(5).numFmt = numFmt;
    row.getCell(6).numFmt = numFmt;
    row.getCell(7).numFmt = '0.0%';
  }

  conSheet.columns = [
    { width: 14 }, { width: 22 }, { width: 16 }, { width: 16 },
    { width: 14 }, { width: 16 }, { width: 14 }, { width: 12 },
  ];

  // Sheet 3: Reconciliation
  const reconRows = await getReconciliationData(farmId);
  const reconSheet = workbook.addWorksheet('Reconciliation');
  reconSheet.addRow([`${farmName} — Reconciliation`]).font = { bold: true, size: 12 };
  reconSheet.addRow([]);
  const reconHeader = reconSheet.addRow(['Commodity', 'Beginning MT', 'Ending MT', 'Hauled MT', 'Variance MT', 'Variance %']);
  reconHeader.font = { bold: true };
  reconSheet.views = [{ state: 'frozen', ySplit: 3 }];

  for (const r of reconRows) {
    const row = reconSheet.addRow([r.commodity, r.beginning_mt, r.ending_mt, r.hauled_mt, r.variance_mt, r.variance_pct / 100]);
    row.getCell(2).numFmt = numFmt;
    row.getCell(3).numFmt = numFmt;
    row.getCell(4).numFmt = numFmt;
    row.getCell(5).numFmt = numFmt;
    row.getCell(6).numFmt = '0.0%';
  }

  reconSheet.columns = [
    { width: 18 }, { width: 16 }, { width: 14 }, { width: 14 }, { width: 14 }, { width: 14 },
  ];

  // Sheet 4: Available to Sell
  const atsRows = await getAvailableToSell(farmId);
  const atsSheet = workbook.addWorksheet('Available to Sell');
  atsSheet.addRow([`${farmName} — Available to Sell`]).font = { bold: true, size: 12 };
  atsSheet.addRow([]);
  const atsHeader = atsSheet.addRow(['Commodity', 'Inventory MT', 'Contracted MT', 'Available MT', '% Committed']);
  atsHeader.font = { bold: true };
  atsSheet.views = [{ state: 'frozen', ySplit: 3 }];

  for (const a of atsRows) {
    const row = atsSheet.addRow([a.commodity_name, a.total_mt, a.contracted_mt, a.available_mt, a.pct_committed / 100]);
    row.getCell(2).numFmt = numFmt;
    row.getCell(3).numFmt = numFmt;
    row.getCell(4).numFmt = numFmt;
    row.getCell(5).numFmt = '0.0%';
  }

  atsSheet.columns = [
    { width: 18 }, { width: 16 }, { width: 16 }, { width: 16 }, { width: 14 },
  ];

  return workbook;
}

// ─── PDF Export ───

export async function generateInventoryPdf(farmId, { locationId } = {}) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  const farmName = farm?.name || 'Farm';

  // Resolve location name for header
  let locationLabel = '';
  if (locationId) {
    const loc = await prisma.inventoryLocation.findUnique({ where: { id: locationId } });
    if (loc) locationLabel = loc.name;
  }

  const noBorder = [false, false, false, false];
  const bottomBorder = [false, false, false, true];

  // Fetch all data (bin inventory filtered by location if provided)
  const { rows: binRows, periodLabel } = await getBinInventoryData(farmId, { locationId });
  const contractRows = await getContractsData(farmId);
  const reconRows = await getReconciliationData(farmId);
  const atsRows = await getAvailableToSell(farmId);

  const fmtNum = (v, dec = 1) => {
    if (v == null || v === '') return '-';
    return typeof v === 'number' ? v.toLocaleString('en-US', { minimumFractionDigits: dec, maximumFractionDigits: dec }) : String(v);
  };
  const fmtPct = (v) => v != null ? `${v.toFixed(1)}%` : '-';
  const fmtInt = (v) => typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(v || '-');

  const tableLayout = {
    hLineWidth: () => 0.5,
    vLineWidth: () => 0,
    hLineColor: () => '#000000',
    paddingLeft: () => 3,
    paddingRight: () => 3,
    paddingTop: () => 1,
    paddingBottom: () => 1,
  };

  // Table 1: Inventory
  const invBody = [
    ['Location', 'Bin #', 'Type', 'Capacity', 'Commodity', 'Bushels', 'KG', 'MT', 'Crop Year'].map(h => ({ text: h, bold: true, border: bottomBorder })),
    ...binRows.map(r => [
      { text: r.location, border: noBorder },
      { text: r.bin_number, border: noBorder },
      { text: r.bin_type, border: noBorder },
      { text: fmtInt(r.capacity_bu), alignment: 'right', border: noBorder },
      { text: r.commodity, border: noBorder },
      { text: fmtInt(r.bushels), alignment: 'right', border: noBorder },
      { text: fmtInt(r.kg), alignment: 'right', border: noBorder },
      { text: fmtNum(r.mt), alignment: 'right', border: noBorder },
      { text: String(r.crop_year || ''), border: noBorder },
    ]),
  ];

  // Table 2: Contracts
  const conBody = [
    ['Contract #', 'Buyer', 'Commodity', 'Contracted MT', 'Hauled MT', 'Remaining MT', '% Complete', 'Status'].map(h => ({ text: h, bold: true, border: bottomBorder })),
    ...contractRows.map(c => [
      { text: c.contract_number, border: noBorder },
      { text: c.buyer, border: noBorder },
      { text: c.commodity, border: noBorder },
      { text: fmtNum(c.contracted_mt), alignment: 'right', border: noBorder },
      { text: fmtNum(c.hauled_mt), alignment: 'right', border: noBorder },
      { text: fmtNum(c.remaining_mt), alignment: 'right', border: noBorder },
      { text: fmtPct(c.pct_complete), alignment: 'right', border: noBorder },
      { text: c.status, border: noBorder },
    ]),
  ];

  // Table 3: Reconciliation
  const reconBody = [
    ['Commodity', 'Beginning MT', 'Ending MT', 'Hauled MT', 'Variance MT', 'Variance %'].map(h => ({ text: h, bold: true, border: bottomBorder })),
    ...reconRows.map(r => [
      { text: r.commodity, border: noBorder },
      { text: fmtNum(r.beginning_mt), alignment: 'right', border: noBorder },
      { text: fmtNum(r.ending_mt), alignment: 'right', border: noBorder },
      { text: fmtNum(r.hauled_mt), alignment: 'right', border: noBorder },
      { text: fmtNum(r.variance_mt), alignment: 'right', border: noBorder },
      { text: fmtPct(r.variance_pct), alignment: 'right', border: noBorder },
    ]),
  ];

  // Table 4: Available to Sell
  const atsBody = [
    ['Commodity', 'Inventory MT', 'Contracted MT', 'Available MT', '% Committed'].map(h => ({ text: h, bold: true, border: bottomBorder })),
    ...atsRows.map(a => [
      { text: a.commodity_name, border: noBorder },
      { text: fmtNum(a.total_mt), alignment: 'right', border: noBorder },
      { text: fmtNum(a.contracted_mt), alignment: 'right', border: noBorder },
      { text: fmtNum(a.available_mt), alignment: 'right', border: noBorder },
      { text: fmtPct(a.pct_committed), alignment: 'right', border: noBorder },
    ]),
  ];

  const title = locationLabel
    ? `${farmName} — ${locationLabel} Inventory Report`
    : `${farmName} — Grain Inventory Report`;

  return {
    pageOrientation: 'portrait',
    pageSize: 'LETTER',
    pageMargins: [30, 40, 30, 30],
    content: [
      { text: title, style: 'header' },
      { text: `As of ${periodLabel}`, style: 'subheader' },
      { text: ' ' },
      { text: 'Current Inventory', style: 'sectionHeader' },
      {
        table: { headerRows: 1, widths: ['auto', 'auto', 'auto', 42, 'auto', 46, 46, 42, 'auto'], body: invBody },
        layout: tableLayout,
        fontSize: 7,
        pageBreak: 'after',
      },
      { text: 'Contracts', style: 'sectionHeader' },
      {
        table: { headerRows: 1, widths: ['auto', '*', 'auto', 55, 50, 55, 50, 45], body: conBody },
        layout: tableLayout,
        fontSize: 7,
      },
      { text: ' ' },
      { text: 'Reconciliation', style: 'sectionHeader' },
      {
        table: { headerRows: 1, widths: ['*', 65, 65, 60, 65, 55], body: reconBody.length > 1 ? reconBody : [[{ text: 'Insufficient period data', colSpan: 6, border: noBorder }]] },
        layout: tableLayout,
        fontSize: 7,
      },
      { text: ' ' },
      { text: 'Available to Sell', style: 'sectionHeader' },
      {
        table: { headerRows: 1, widths: ['*', 70, 70, 70, 60], body: atsBody },
        layout: tableLayout,
        fontSize: 7,
      },
    ],
    styles: {
      header: { fontSize: 14, bold: true, margin: [0, 0, 0, 5] },
      subheader: { fontSize: 10, color: '#666', margin: [0, 0, 0, 10] },
      sectionHeader: { fontSize: 10, bold: true, margin: [0, 10, 0, 4] },
    },
    defaultStyle: { fontSize: 7 },
  };
}

// ─── CSV Export ───

const CSV_TYPES = {
  inventory: {
    columns: ['Location', 'Bin #', 'Type', 'Capacity (bu)', 'Commodity', 'Bushels', 'KG', 'MT', 'Crop Year'],
    getData: async (farmId) => {
      const { rows } = await getBinInventoryData(farmId);
      return rows.map(r => [r.location, r.bin_number, r.bin_type, r.capacity_bu, r.commodity, r.bushels, r.kg, r.mt, r.crop_year]);
    },
  },
  contracts: {
    columns: ['Contract #', 'Buyer', 'Commodity', 'Contracted MT', 'Hauled MT', 'Remaining MT', '% Complete', 'Status'],
    getData: async (farmId) => {
      const rows = await getContractsData(farmId);
      return rows.map(c => [c.contract_number, c.buyer, c.commodity, c.contracted_mt, c.hauled_mt, c.remaining_mt, c.pct_complete, c.status]);
    },
  },
  reconciliation: {
    columns: ['Commodity', 'Beginning MT', 'Ending MT', 'Hauled MT', 'Variance MT', 'Variance %'],
    getData: async (farmId) => {
      const rows = await getReconciliationData(farmId);
      return rows.map(r => [r.commodity, r.beginning_mt, r.ending_mt, r.hauled_mt, r.variance_mt, r.variance_pct]);
    },
  },
  available: {
    columns: ['Commodity', 'Inventory MT', 'Contracted MT', 'Available MT', '% Committed'],
    getData: async (farmId) => {
      const rows = await getAvailableToSell(farmId);
      return rows.map(a => [a.commodity_name, a.total_mt, a.contracted_mt, a.available_mt, a.pct_committed]);
    },
  },
};

export async function generateInventoryCsv(farmId, type) {
  const config = CSV_TYPES[type];
  if (!config) throw new Error(`Unknown CSV type: ${type}`);

  const dataRows = await config.getData(farmId);
  const escapeCsv = (val) => {
    const s = val == null ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines = [config.columns.map(escapeCsv).join(',')];
  for (const row of dataRows) {
    lines.push(row.map(escapeCsv).join(','));
  }
  return lines.join('\n');
}
