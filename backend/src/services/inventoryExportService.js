import ExcelJS from 'exceljs';
import prisma from '../config/database.js';
import {
  getLatestPeriod, getAvailableToSell, convertKgToMt, getLocationCommodityMatrix,
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

  const { rows: binRows, periodLabel } = await getBinInventoryData(farmId);

  // Sheet 1: Current Inventory (raw data)
  const invSheet = workbook.addWorksheet('Current Inventory');
  invSheet.addRow(['Location', 'Bin #', 'Type', 'Capacity (bu)', 'Commodity', 'Bushels', 'KG', 'MT', 'Crop Year']);
  invSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of binRows) {
    invSheet.addRow([r.location, r.bin_number, r.bin_type, r.capacity_bu, r.commodity, r.bushels, r.kg, r.mt, r.crop_year]);
  }

  // Sheet 2: Contracts
  const contractRows = await getContractsData(farmId);
  const conSheet = workbook.addWorksheet('Contracts');
  conSheet.addRow(['Contract #', 'Buyer', 'Commodity', 'Contracted MT', 'Hauled MT', 'Remaining MT', '% Complete', 'Status']);
  conSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const c of contractRows) {
    conSheet.addRow([c.contract_number, c.buyer, c.commodity, c.contracted_mt, c.hauled_mt, c.remaining_mt, c.pct_complete / 100, c.status]);
  }

  // Sheet 3: Reconciliation
  const reconRows = await getReconciliationData(farmId);
  const reconSheet = workbook.addWorksheet('Reconciliation');
  reconSheet.addRow(['Commodity', 'Beginning MT', 'Ending MT', 'Hauled MT', 'Variance MT', 'Variance %']);
  reconSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const r of reconRows) {
    reconSheet.addRow([r.commodity, r.beginning_mt, r.ending_mt, r.hauled_mt, r.variance_mt, r.variance_pct / 100]);
  }

  // Sheet 4: Available to Sell
  const atsRows = await getAvailableToSell(farmId);
  const atsSheet = workbook.addWorksheet('Available to Sell');
  atsSheet.addRow(['Commodity', 'Inventory MT', 'Contracted MT', 'Available MT', '% Committed']);
  atsSheet.views = [{ state: 'frozen', ySplit: 1 }];
  for (const a of atsRows) {
    atsSheet.addRow([a.commodity_name, a.total_mt, a.contracted_mt, a.available_mt, a.pct_committed / 100]);
  }

  // Sheet 5: Location × Commodity Matrix
  const matrixData = await getLocationCommodityMatrix(farmId);
  if (matrixData.rows.length > 0) {
    const matSheet = workbook.addWorksheet('Location × Commodity');
    matSheet.addRow(['Location', ...matrixData.commodities, 'Total']);
    matSheet.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of matrixData.rows) {
      matSheet.addRow([r.location, ...matrixData.commodities.map(c => r.values[c] || 0), r.total]);
    }
    matSheet.addRow(['Total', ...matrixData.commodities.map(c => matrixData.totals[c] || 0), matrixData.grandTotal]);
  }

  return workbook;
}

// ─── PDF Export ───

export async function generateInventoryPdf(farmId, { locationId } = {}) {
  const farm = await prisma.farm.findUnique({ where: { id: farmId } });
  const farmName = farm?.name || 'Farm';

  let locationLabel = '';
  if (locationId) {
    const loc = await prisma.inventoryLocation.findUnique({ where: { id: locationId } });
    if (loc) locationLabel = loc.name;
  }

  const noBorder = [false, false, false, false];
  const dateStr = new Date().toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });

  // Fetch all data
  const { rows: binRows, periodLabel } = await getBinInventoryData(farmId, { locationId });
  const contractRows = await getContractsData(farmId);
  const reconRows = await getReconciliationData(farmId);
  const atsRows = await getAvailableToSell(farmId);
  const matrixData = await getLocationCommodityMatrix(farmId);

  const fmtNum = (v) => {
    if (v == null || v === '') return '—';
    return typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 1 }) : String(v);
  };
  const fmtDollar = (v) => v != null ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}` : '$0';
  const fmtPct = (v) => v != null ? `${v.toFixed(1)}%` : '—';
  const fmtInt = (v) => typeof v === 'number' ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : String(v || '—');

  // ─── Styling ───
  const colors = { primary: '#1565C0', accent: '#2E7D32', warn: '#E65100', grey: '#757575', lightGrey: '#F5F5F5', headerBg: '#1565C0', headerText: '#FFFFFF' };
  const cellPad = { paddingLeft: () => 6, paddingRight: () => 6, paddingTop: () => 4, paddingBottom: () => 4 };
  const cleanLayout = { hLineWidth: () => 0, vLineWidth: () => 0, ...cellPad };

  // ─── Compute KPIs ───
  const totalMt = binRows.reduce((s, r) => s + r.mt, 0);
  const totalBins = binRows.length;
  const occupiedBins = binRows.filter(r => r.mt > 0).length;
  const totalContracted = contractRows.reduce((s, c) => s + c.contracted_mt, 0);
  const totalHauled = contractRows.reduce((s, c) => s + c.hauled_mt, 0);
  const availableMt = atsRows.reduce((s, a) => s + a.available_mt, 0);
  const locationCount = matrixData.rows?.length || 0;
  const cropCount = matrixData.commodities?.length || 0;

  // ─── Title bar ───
  const titleBar = {
    table: {
      widths: ['*'],
      body: [[{
        stack: [
          { text: farmName.toUpperCase(), fontSize: 9, color: '#FFFFFF', bold: true, margin: [0, 0, 0, 2] },
          { text: locationLabel ? `${locationLabel} — Grain Inventory Report` : 'Grain Inventory Report', fontSize: 16, color: '#FFFFFF', bold: true },
          { text: `Period: ${periodLabel}  |  Generated: ${dateStr}`, fontSize: 8, color: '#B3D4FC' },
        ],
        fillColor: colors.primary,
        border: noBorder,
        margin: [8, 8, 8, 8],
      }]],
    },
    layout: { hLineWidth: () => 0, vLineWidth: () => 0 },
    margin: [0, 0, 0, 14],
  };

  // ─── KPI cards ───
  const kpiCard = (label, value, sub) => ({
    stack: [
      { text: label, fontSize: 7, color: colors.grey, margin: [0, 0, 0, 2] },
      { text: value, fontSize: 16, bold: true, color: colors.primary },
      ...(sub ? [{ text: sub, fontSize: 7, color: colors.grey, margin: [0, 2, 0, 0] }] : []),
    ],
    alignment: 'center',
    margin: [0, 4, 0, 4],
  });

  const kpiTable = {
    table: {
      widths: ['*', '*', '*', '*', '*'],
      body: [[
        kpiCard('Total Inventory', `${fmtNum(totalMt)} MT`, `${locationCount} locations`),
        kpiCard('Bins', `${occupiedBins}`, `of ${totalBins} total`),
        kpiCard('Contracted', `${fmtNum(totalContracted)} MT`, `${fmtNum(totalHauled)} MT hauled`),
        kpiCard('Available to Sell', `${fmtNum(availableMt)} MT`, totalMt > 0 ? `${((availableMt / totalMt) * 100).toFixed(0)}% of inventory` : ''),
        kpiCard('Commodities', `${cropCount}`, `across ${locationCount} sites`),
      ]],
    },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => '#E0E0E0', vLineColor: () => '#E0E0E0',
      ...cellPad,
    },
    margin: [0, 0, 0, 16],
  };

  // ─── Crop Inventory Summary ───
  const cropMap = {};
  for (const r of binRows) {
    if (!r.commodity) continue;
    if (!cropMap[r.commodity]) cropMap[r.commodity] = { mt: 0, bins: 0, bushels: 0 };
    cropMap[r.commodity].mt += r.mt;
    cropMap[r.commodity].bins++;
    cropMap[r.commodity].bushels += r.bushels;
  }
  const cropSummary = Object.entries(cropMap).sort((a, b) => b[1].mt - a[1].mt);
  const maxCropMt = cropSummary.length > 0 ? cropSummary[0][1].mt : 1;

  const cropTable = {
    table: {
      headerRows: 1,
      widths: ['auto', 'auto', 'auto', 'auto', '*'],
      body: [
        [
          { text: 'Commodity', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder },
          { text: 'Bins', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          { text: 'Bushels', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          { text: 'Metric Tons', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          { text: '', fillColor: colors.headerBg, border: noBorder },
        ],
        ...cropSummary.map(([name, data], i) => {
          const barWidth = Math.max(8, Math.round((data.mt / maxCropMt) * 140));
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          return [
            { text: name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
            { text: String(data.bins), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtInt(data.bushels), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(data.mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            {
              table: { widths: [barWidth], body: [[{ text: '', fillColor: colors.accent, border: noBorder }]] },
              layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 },
              fillColor: bg, border: noBorder,
            },
          ];
        }),
        // Totals
        [
          { text: 'Total', bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
          { text: String(cropSummary.reduce((s, [, d]) => s + d.bins, 0)), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtInt(cropSummary.reduce((s, [, d]) => s + d.bushels, 0)), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtNum(totalMt), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: '', fillColor: '#E8EAF6', border: noBorder },
        ],
      ],
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 12],
  };

  // ─── Location × Commodity Matrix ───
  const matrixContent = [];
  if (matrixData.rows && matrixData.rows.length > 0) {
    matrixContent.push(
      { text: 'Inventory by Location (MT)', style: 'sectionHeader' },
      {
        table: {
          headerRows: 1,
          widths: ['*', ...matrixData.commodities.map(() => 'auto'), 'auto'],
          body: [
            [
              { text: 'Location', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder },
              ...matrixData.commodities.map(c => ({ text: c, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder })),
              { text: 'Total', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
            ],
            ...matrixData.rows.map((r, i) => {
              const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
              return [
                { text: r.location, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
                ...matrixData.commodities.map(c => ({ text: r.values[c] ? fmtNum(r.values[c]) : '—', fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder })),
                { text: fmtNum(r.total), fontSize: 8, alignment: 'right', bold: true, fillColor: bg, border: noBorder },
              ];
            }),
            [
              { text: 'Total', bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
              ...matrixData.commodities.map(c => ({ text: fmtNum(matrixData.totals[c]), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder })),
              { text: fmtNum(matrixData.grandTotal), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
            ],
          ],
        },
        layout: cleanLayout,
        margin: [0, 0, 0, 12],
      },
    );
  }

  // ─── Available to Sell table ───
  const atsTable = {
    table: {
      headerRows: 1,
      widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        [
          { text: 'Commodity', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder },
          { text: 'Inventory (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          { text: 'Contracted (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          { text: 'Available (MT)', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          { text: '% Committed', bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, alignment: 'right', border: noBorder },
          { text: '', fillColor: colors.headerBg, border: noBorder },
        ],
        ...atsRows.map((a, i) => {
          const pct = a.pct_committed || 0;
          const barWidth = Math.max(4, Math.round(Math.min(pct, 100) * 1.2));
          const barColor = pct > 90 ? '#D32F2F' : pct > 70 ? '#E65100' : colors.accent;
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          return [
            { text: a.commodity_name, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
            { text: fmtNum(a.total_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(a.contracted_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(a.available_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder,
              ...(a.available_mt <= 0 ? { color: '#D32F2F', bold: true } : {}),
            },
            { text: fmtPct(pct), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder,
              ...(pct > 90 ? { color: '#D32F2F', bold: true } : {}),
            },
            {
              table: { widths: [barWidth, Math.max(0, 120 - barWidth)], body: [[{ text: '', fillColor: barColor, border: noBorder }, { text: '', fillColor: '#E0E0E0', border: noBorder }]] },
              layout: { hLineWidth: () => 0, vLineWidth: () => 0, paddingLeft: () => 0, paddingRight: () => 0, paddingTop: () => 3, paddingBottom: () => 3 },
              fillColor: bg, border: noBorder,
            },
          ];
        }),
      ],
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 12],
  };

  // ─── Reconciliation table ───
  const reconContent = [];
  if (reconRows.length > 0) {
    reconContent.push(
      { text: 'Period Reconciliation', style: 'sectionHeader' },
      {
        table: {
          headerRows: 1,
          widths: ['*', 'auto', 'auto', 'auto', 'auto', 'auto'],
          body: [
            ['Commodity', 'Beginning (MT)', 'Ending (MT)', 'Hauled (MT)', 'Variance (MT)', 'Variance %'].map(h =>
              ({ text: h, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
            ),
            ...reconRows.map((r, i) => {
              const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
              const varColor = Math.abs(r.variance_pct) > 5 ? '#D32F2F' : undefined;
              return [
                { text: r.commodity, bold: true, fontSize: 8, fillColor: bg, border: noBorder },
                { text: fmtNum(r.beginning_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
                { text: fmtNum(r.ending_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
                { text: fmtNum(r.hauled_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
                { text: fmtNum(r.variance_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder, ...(varColor ? { color: varColor, bold: true } : {}) },
                { text: fmtPct(r.variance_pct), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder, ...(varColor ? { color: varColor, bold: true } : {}) },
              ];
            }),
          ],
        },
        layout: cleanLayout,
        margin: [0, 0, 0, 12],
      },
    );
  }

  // ─── Contracts summary table ───
  const contractsTable = {
    table: {
      headerRows: 1,
      widths: ['auto', '*', 'auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
      body: [
        ['Contract #', 'Buyer', 'Commodity', 'Contracted (MT)', 'Hauled (MT)', 'Remaining (MT)', '% Complete', 'Status'].map(h =>
          ({ text: h, bold: true, fontSize: 8, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
        ),
        ...contractRows.map((c, i) => {
          const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
          return [
            { text: c.contract_number, fontSize: 8, fillColor: bg, border: noBorder },
            { text: c.buyer, fontSize: 8, fillColor: bg, border: noBorder },
            { text: c.commodity, fontSize: 8, fillColor: bg, border: noBorder },
            { text: fmtNum(c.contracted_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(c.hauled_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtNum(c.remaining_mt), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: fmtPct(c.pct_complete), fontSize: 8, alignment: 'right', fillColor: bg, border: noBorder },
            { text: c.status, fontSize: 8, fillColor: bg, border: noBorder },
          ];
        }),
        // Totals
        [
          { text: `${contractRows.length} contracts`, bold: true, fontSize: 8, fillColor: '#E8EAF6', border: noBorder },
          { text: '', fillColor: '#E8EAF6', border: noBorder },
          { text: '', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtNum(totalContracted), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtNum(totalHauled), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: fmtNum(totalContracted - totalHauled), bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: totalContracted > 0 ? fmtPct((totalHauled / totalContracted) * 100) : '—', bold: true, fontSize: 8, alignment: 'right', fillColor: '#E8EAF6', border: noBorder },
          { text: '', fillColor: '#E8EAF6', border: noBorder },
        ],
      ],
    },
    layout: cleanLayout,
    margin: [0, 0, 0, 12],
  };

  // ─── Bin Detail table (landscape page) ───
  const binDetailBody = [
    ['Location', 'Bin #', 'Type', 'Capacity (bu)', 'Commodity', 'Bushels', 'MT', 'Crop Year'].map(h =>
      ({ text: h, bold: true, fontSize: 7, color: colors.headerText, fillColor: colors.headerBg, border: noBorder })
    ),
    ...binRows.map((r, i) => {
      const bg = i % 2 === 0 ? '#FFFFFF' : colors.lightGrey;
      return [
        { text: r.location, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.bin_number, fontSize: 7, fillColor: bg, border: noBorder },
        { text: r.bin_type, fontSize: 7, fillColor: bg, border: noBorder },
        { text: fmtInt(r.capacity_bu), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: r.commodity, fontSize: 7, fillColor: bg, border: noBorder },
        { text: fmtInt(r.bushels), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: fmtNum(r.mt), fontSize: 7, alignment: 'right', fillColor: bg, border: noBorder },
        { text: String(r.crop_year || ''), fontSize: 7, fillColor: bg, border: noBorder },
      ];
    }),
  ];

  const footer = { text: `C2 Farms  |  ${farmName}  |  Generated ${dateStr}`, fontSize: 6, color: colors.grey, alignment: 'center', margin: [0, 14, 0, 0] };

  // ─── Helper: wrap section header + table in unbreakable block ───
  const section = (title, table) => ({
    unbreakable: true,
    stack: [
      { text: title, style: 'sectionHeader' },
      table,
    ],
  });

  // ─── Build summary sections ───
  const summaryContent = [
    // Title + KPIs always first
    titleBar,
    kpiTable,
    section('Inventory by Commodity', cropTable),
  ];

  if (matrixContent.length > 0) {
    summaryContent.push({
      unbreakable: true,
      stack: matrixContent,
    });
  }

  summaryContent.push(section('Available to Sell', atsTable));

  if (reconContent.length > 0) {
    summaryContent.push({
      unbreakable: true,
      stack: reconContent,
    });
  }

  summaryContent.push(section('Contracts', contractsTable));
  summaryContent.push(footer);

  // ─── Assemble document ───
  return {
    pageOrientation: 'landscape',
    pageSize: 'LETTER',
    pageMargins: [28, 28, 28, 28],
    content: [
      ...summaryContent,

      // Bin detail pages (long table — allowed to span multiple pages)
      { text: 'Bin Inventory Detail', style: 'sectionHeader', pageBreak: 'before' },
      { text: `${binRows.length} bins across ${locationCount} locations  |  Period: ${periodLabel}`, fontSize: 7, color: colors.grey, margin: [0, 0, 0, 6] },
      {
        table: {
          headerRows: 1,
          widths: ['auto', 'auto', 'auto', 'auto', '*', 'auto', 'auto', 'auto'],
          body: binDetailBody,
        },
        layout: {
          hLineWidth: () => 0, vLineWidth: () => 0,
          paddingLeft: () => 4, paddingRight: () => 4,
          paddingTop: () => 2, paddingBottom: () => 2,
        },
      },
      footer,
    ],
    styles: {
      sectionHeader: { fontSize: 10, bold: true, color: colors.primary, margin: [0, 4, 0, 6] },
    },
    defaultStyle: { fontSize: 8 },
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
  'location-commodity': {
    columns: null, // dynamic — built from matrix data
    getData: async (farmId) => {
      const data = await getLocationCommodityMatrix(farmId);
      const header = ['Location', ...data.commodities, 'Total'];
      const rows = data.rows.map(r => [r.location, ...data.commodities.map(c => r.values[c] || 0), r.total]);
      rows.push(['Total', ...data.commodities.map(c => data.totals[c] || 0), data.grandTotal]);
      return { header, rows };
    },
  },
};

export async function generateInventoryCsv(farmId, type) {
  const config = CSV_TYPES[type];
  if (!config) throw new Error(`Unknown CSV type: ${type}`);

  const escapeCsv = (val) => {
    const s = val == null ? '' : String(val);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const result = await config.getData(farmId);

  // Support dynamic columns (location-commodity matrix)
  if (result && result.header) {
    const lines = [result.header.map(escapeCsv).join(',')];
    for (const row of result.rows) {
      lines.push(row.map(escapeCsv).join(','));
    }
    return lines.join('\n');
  }

  const lines = [config.columns.map(escapeCsv).join(',')];
  for (const row of result) {
    lines.push(row.map(escapeCsv).join(','));
  }
  return lines.join('\n');
}
